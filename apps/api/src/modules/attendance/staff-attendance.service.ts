// Staff attendance (T-76): an employee's day is worked out on read from their terminal passes — first IN, last OUT —
// against the staff working day in the settings. Raw events are never changed. A day with no terminal data at all is
// NO_DATA, never an absence (same rule as for students). On a day off of the school calendar (T-86) nobody is absent:
// only the employees who came are listed, without lateness.
import type { z } from "zod";
import type { Db } from "@idrok/db";
import type { StaffAttendanceDayDto, StaffAttendanceQuerySchema } from "@idrok/shared";
import { schoolDateToDb } from "@idrok/shared/time";
import { dailyAttendance, isDayOver, type DayRules } from "../../domain/attendance";
import { schoolClock } from "../access/school-clock";
import { attendanceSettings } from "./attendance-config.service";
import { staffWorkingDay } from "./school-day";

const STATUSES = ["PRESENT", "LATE", "ABSENT", "NOT_ARRIVED", "EXCUSED", "NO_DATA"] as const;

export class StaffAttendanceService {
  constructor(private readonly db: Db) {}

  async day(q: z.infer<typeof StaffAttendanceQuerySchema>): Promise<StaffAttendanceDayDto> {
    const [settings, clock] = await Promise.all([attendanceSettings(this.db), schoolClock(this.db)]);
    const date = q.date ?? clock.today;
    const d = schoolDateToDb(date);
    const [employees, events, anyEvent, workingDay] = await Promise.all([
      this.db.employee.findMany({
        where: {
          OR: [
            { status: "ACTIVE", faceProfile: { some: { photoAssetId: { not: null } } } },
            { accessEvents: { some: { schoolDate: d } } },
          ],
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          positionTitle: true,
          faceProfile: { select: { photoAssetId: true } },
        },
      }),
      this.db.accessEvent.findMany({
        where: { schoolDate: d, employeeId: { not: null } },
        orderBy: { occurredAt: "asc" },
        select: { employeeId: true, occurredAt: true, direction: true },
      }),
      this.db.accessEvent.findFirst({ where: { schoolDate: d }, select: { id: true } }),
      staffWorkingDay(this.db, date),
    ]);
    const rules: DayRules = {
      schoolDate: date,
      startMinute: settings.staffStartMinute,
      endMinute: settings.staffEndMinute,
      graceMinutes: settings.staffGraceMinutes,
      bands: [],
      tz: clock.timezone,
    };
    const dayOver = isDayOver(rules, new Date());
    const tracked = !!anyEvent;
    let rows = employees.map((e) => {
      const mine = events
        .filter((x) => x.employeeId === e.id)
        .map((x) => ({ at: x.occurredAt, direction: x.direction }));
      const worked = dailyAttendance(mine, rules, dayOver);
      // A day off: whoever came is simply present, with no lateness or early leave.
      const r = workingDay ? worked : { ...worked, status: "PRESENT" as const, lateMinutes: 0, earlyLeaveMinutes: 0 };
      return {
        employeeId: e.id,
        firstName: e.firstName,
        lastName: e.lastName,
        positionTitle: e.positionTitle,
        hasFace: !!e.faceProfile[0]?.photoAssetId,
        status: !r.firstInAt && !tracked && date !== clock.today ? ("NO_DATA" as const) : r.status,
        firstInAt: r.firstInAt?.toISOString() ?? null,
        lastOutAt: r.lastOutAt?.toISOString() ?? null,
        lateMinutes: r.lateMinutes,
        earlyLeaveMinutes: r.earlyLeaveMinutes,
      };
    });
    if (!workingDay) rows = rows.filter((r) => r.firstInAt);
    const text = q.q?.toLowerCase();
    if (text) rows = rows.filter((r) => `${r.lastName} ${r.firstName}`.toLowerCase().includes(text));
    const counts = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
    if (q.status) rows = rows.filter((r) => r.status === q.status);
    const start = (q.page - 1) * q.pageSize;
    return {
      date,
      workingDay,
      startMinute: rules.startMinute,
      endMinute: rules.endMinute,
      items: rows.slice(start, start + q.pageSize),
      total: rows.length,
      page: q.page,
      pageSize: q.pageSize,
      counts,
    };
  }
}

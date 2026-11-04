// Who is expected at school on a day and with which times: the student's class on that day (enrollment), the class's
// shift (else the school default) and the school calendar (working weekdays, holidays per grade).
import type { Db, DbTransaction, Prisma } from "@idrok/db";
import { atSchoolTime, schoolDateFromDb, schoolDateToDb, type SchoolDate } from "@idrok/shared/time";
import type { DayRules, LatenessBand } from "../../domain/attendance";
import { lessonWeekday, type CalendarDayInput } from "../../domain/lessons";
import { activeOn } from "../access/scope";
import { DEFAULT_WORKING_WEEKDAYS } from "../calendar/calendar.service";
import type { attendanceSettings } from "./attendance-config.service";

export interface StudentDay {
  studentId: string;
  classGroupId: string;
  className: string;
  /** false = a day off for the student's grade. */
  expected: boolean;
  rules: DayRules;
}

type Settings = Awaited<ReturnType<typeof attendanceSettings>>;

/**
 * The day for each student with an enrollment active on `date` (all such students when `studentIds` is omitted).
 * Students without a class that day are not part of the result.
 */
export async function studentDays(
  db: Db | DbTransaction,
  date: SchoolDate,
  ctx: { settings: Settings; bands: LatenessBand[]; tz: string },
  where: { studentIds?: string[]; student?: Prisma.StudentWhereInput } = {},
): Promise<Map<string, StudentDay>> {
  const d = schoolDateToDb(date);
  const enrollments = await db.studentEnrollment.findMany({
    where: {
      ...activeOn(date),
      status: { not: "CANCELLED" },
      ...(where.studentIds ? { studentId: { in: where.studentIds } } : {}),
      student: { status: "ACTIVE", ...where.student },
    },
    orderBy: { validFrom: "desc" },
    select: {
      studentId: true,
      academicYearId: true,
      classGroup: {
        select: {
          id: true,
          name: true,
          gradeId: true,
          shift: { select: { startMinute: true, endMinute: true } },
        },
      },
    },
  });
  const yearIds = [...new Set(enrollments.map((e) => e.academicYearId))];
  const [weeks, marks] = await Promise.all([
    db.schoolWeek.findMany({ where: { academicYearId: { in: yearIds } } }),
    db.calendarDay.findMany({
      where: { academicYearId: { in: yearIds }, date: d },
      select: {
        academicYearId: true,
        date: true,
        kind: true,
        followsWeekday: true,
        appliesToAll: true,
        grades: { select: { gradeId: true } },
      },
    }),
  ]);
  const weekdays = new Map(weeks.map((w) => [w.academicYearId, new Set(w.workingWeekdays)]));
  const markOf = new Map<string, Map<string, CalendarDayInput>>();
  for (const m of marks) {
    markOf.set(
      m.academicYearId,
      new Map([
        [
          schoolDateFromDb(m.date),
          {
            date: schoolDateFromDb(m.date),
            kind: m.kind,
            followsWeekday: m.followsWeekday,
            gradeIds: m.appliesToAll ? null : m.grades.map((g) => g.gradeId),
          },
        ],
      ]),
    );
  }
  const out = new Map<string, StudentDay>();
  for (const e of enrollments) {
    if (out.has(e.studentId)) continue; // newest enrollment wins on a transfer day
    const working = weekdays.get(e.academicYearId) ?? new Set(DEFAULT_WORKING_WEEKDAYS);
    const expected =
      lessonWeekday(date, e.classGroup.gradeId, working, markOf.get(e.academicYearId) ?? new Map()) !== null;
    out.set(e.studentId, {
      studentId: e.studentId,
      classGroupId: e.classGroup.id,
      className: e.classGroup.name,
      expected,
      rules: {
        schoolDate: date,
        startMinute: e.classGroup.shift?.startMinute ?? ctx.settings.defaultStartMinute,
        endMinute: e.classGroup.shift?.endMinute ?? ctx.settings.defaultEndMinute,
        graceMinutes: ctx.settings.graceMinutes,
        bands: ctx.bands,
        tz: ctx.tz,
      },
    });
  }
  return out;
}

/** "+05:00": the school time zone's UTC offset on a day (terminals take local times with an offset). */
export function offsetOf(day: SchoolDate, tz: string): string {
  const minutes = Math.round((schoolDateToDb(day).getTime() - atSchoolTime(day, 0, tz).getTime()) / 60_000);
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  return `${minutes < 0 ? "-" : "+"}${hh}:${String(abs % 60).padStart(2, "0")}`;
}

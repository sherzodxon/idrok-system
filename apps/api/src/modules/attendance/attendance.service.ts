// School attendance journal (SCHOOL_ATTENDANCE): the day list of expected students, a student's history, manual marks
// and the raw event / monitoring views. Statuses are derived on read: a manual mark wins, then the device result, then
// "not arrived yet" / "absent" by the end of the student's shift. Days off are not counted, and neither are days on
// which no terminal recorded anything (before the launch, or every terminal down): those are NO_DATA, never absent.
import type { z } from "zod";
import { requireTenantId, type Db, type Prisma } from "@idrok/db";
import type {
  AccessEventDto,
  AccessEventQuerySchema,
  AttendanceDayDto,
  AttendanceDayQuerySchema,
  AttendanceDayRowDto,
  AttendanceMonitoringDto,
  AttendanceSummaryDto,
  AttendanceSummaryQuerySchema,
  ManualMarkSchema,
  SchoolAttendanceStatusDto,
  StudentAttendanceDto,
  StudentAttendanceQuerySchema,
} from "@idrok/shared";
import {
  addSchoolDays,
  diffSchoolDays,
  eachSchoolDate,
  schoolDateFromDb,
  schoolDateToDb,
  type SchoolDate,
} from "@idrok/shared/time";
import { attendanceRate, connectionStatus, isDayOver } from "../../domain/attendance";
import type { RequestAuth } from "../../http/auth";
import { AppError, notFound } from "../../http/errors";
import { writeAudit } from "../audit/audit.service";
import { schoolClock } from "../access/school-clock";
import { resolveScope, studentWhere, type DataScope } from "../access/scope";
import { activeBands, attendanceSettings } from "./attendance-config.service";
import { studentDays, type StudentDay } from "./school-day";

const MAX_RANGE_DAYS = 92;
const STATUSES: SchoolAttendanceStatusDto[] = ["PRESENT", "LATE", "ABSENT", "NOT_ARRIVED", "EXCUSED", "NO_DATA"];

/** Attendance is a class matter: teachers see their homeroom classes only (rbac-matrix). */
function attendanceStudentWhere(scope: DataScope, today: SchoolDate): Prisma.StudentWhereInput {
  if (scope.kind === "teacher") {
    return { enrollments: { some: { classGroupId: { in: scope.homeroomClassIds }, status: "ACTIVE" } } };
  }
  return studentWhere(scope, today);
}

const recordSelect = {
  studentId: true,
  schoolDate: true,
  firstInAt: true,
  lastOutAt: true,
  deviceStatus: true,
  lateMinutes: true,
  latenessBand: { select: { name: true } },
  earlyLeaveMinutes: true,
  manualStatus: true,
  manualReason: true,
} satisfies Prisma.AttendanceRecordSelect;
type RecordRow = Prisma.AttendanceRecordGetPayload<{ select: typeof recordSelect }>;

function dayFields(rec: RecordRow | undefined, day: Pick<StudentDay, "rules">, now: Date, tracked: boolean) {
  const deviceStatus: SchoolAttendanceStatusDto =
    rec?.deviceStatus ?? (!isDayOver(day.rules, now) ? "NOT_ARRIVED" : tracked ? "ABSENT" : "NO_DATA");
  return {
    status: rec?.manualStatus ?? deviceStatus,
    deviceStatus,
    firstInAt: rec?.firstInAt?.toISOString() ?? null,
    lastOutAt: rec?.lastOutAt?.toISOString() ?? null,
    lateMinutes: rec?.lateMinutes ?? 0,
    latenessBandName: rec?.latenessBand?.name ?? null,
    earlyLeaveMinutes: rec?.earlyLeaveMinutes ?? 0,
    manualStatus: rec?.manualStatus ?? null,
    manualReason: rec?.manualReason ?? null,
  };
}

const countBy = (statuses: SchoolAttendanceStatusDto[]) =>
  Object.fromEntries(STATUSES.map((s) => [s, statuses.filter((x) => x === s).length]));

export class AttendanceService {
  constructor(private readonly db: Db) {}

  /** School days on which at least one terminal event was stored. */
  private async trackedDates(from: SchoolDate, to: SchoolDate): Promise<Set<string>> {
    const rows = await this.db.accessEvent.groupBy({
      by: ["schoolDate"],
      where: { schoolDate: { gte: schoolDateToDb(from), lte: schoolDateToDb(to) } },
    });
    return new Set(rows.map((r) => schoolDateFromDb(r.schoolDate)));
  }

  private async ctx() {
    const [settings, bands, clock] = await Promise.all([
      attendanceSettings(this.db),
      activeBands(this.db),
      schoolClock(this.db),
    ]);
    return { settings, bands, tz: clock.timezone, today: clock.today };
  }

  async day(auth: RequestAuth, q: z.infer<typeof AttendanceDayQuerySchema>): Promise<AttendanceDayDto> {
    const ctx = await this.ctx();
    const date = q.date ?? ctx.today;
    const scope = await resolveScope(this.db, auth, ctx.tz);
    const days = await studentDays(this.db, date, ctx, { student: attendanceStudentWhere(scope, ctx.today) });
    const expected = [...days.values()].filter(
      (d) => d.expected && (!q.classGroupId || d.classGroupId === q.classGroupId),
    );
    const ids = expected.map((d) => d.studentId);
    const [students, records] = await Promise.all([
      this.db.student.findMany({
        where: { id: { in: ids } },
        select: { id: true, studentCode: true, firstName: true, lastName: true },
      }),
      this.db.attendanceRecord.findMany({
        where: { studentId: { in: ids }, schoolDate: schoolDateToDb(date) },
        select: recordSelect,
      }),
    ]);
    const recOf = new Map(records.map((r) => [r.studentId, r]));
    const studentOf = new Map(students.map((s) => [s.id, s]));
    const tracked = (await this.trackedDates(date, date)).has(date);
    const now = new Date();
    let rows: AttendanceDayRowDto[] = expected.map((d) => {
      const s = studentOf.get(d.studentId)!;
      return {
        studentId: s.id,
        studentCode: s.studentCode,
        firstName: s.firstName,
        lastName: s.lastName,
        className: d.className,
        ...dayFields(recOf.get(d.studentId), d, now, tracked),
      };
    });
    const text = q.q?.toLowerCase();
    if (text) {
      rows = rows.filter((r) => `${r.lastName} ${r.firstName} ${r.studentCode}`.toLowerCase().includes(text));
    }
    const counts = countBy(rows.map((r) => r.status));
    if (q.status) rows = rows.filter((r) => r.status === q.status);
    rows.sort(
      (a, b) =>
        (a.className ?? "").localeCompare(b.className ?? "") ||
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName),
    );
    const start = (q.page - 1) * q.pageSize;
    return {
      date,
      schoolDay: [...days.values()].some((d) => d.expected) || days.size === 0,
      items: rows.slice(start, start + q.pageSize),
      total: rows.length,
      page: q.page,
      pageSize: q.pageSize,
      counts,
    };
  }

  /** Counts of one day for the expected students in scope (statuses as in `day`). */
  private async dayCounts(
    date: SchoolDate,
    ctx: Awaited<ReturnType<AttendanceService["ctx"]>>,
    student: Prisma.StudentWhereInput,
    tracked: boolean,
    now: Date,
  ) {
    const days = await studentDays(this.db, date, ctx, { student });
    const expected = [...days.values()].filter((d) => d.expected);
    const records = expected.length
      ? await this.db.attendanceRecord.findMany({
          where: { studentId: { in: expected.map((d) => d.studentId) }, schoolDate: schoolDateToDb(date) },
          select: recordSelect,
        })
      : [];
    const recOf = new Map(records.map((r) => [r.studentId, r]));
    const rows = expected.map((d) => ({ day: d, status: dayFields(recOf.get(d.studentId), d, now, tracked).status }));
    return { schoolDay: expected.length > 0 || days.size === 0, rows };
  }

  /**
   * Dashboard: today by class plus the last `days` calendar days (school days only). One pass per day — a short
   * range by design (≤ 31); the full history stays in the student and day views.
   */
  async summary(auth: RequestAuth, q: z.infer<typeof AttendanceSummaryQuerySchema>): Promise<AttendanceSummaryDto> {
    const ctx = await this.ctx();
    const scope = await resolveScope(this.db, auth, ctx.tz);
    const student = attendanceStudentWhere(scope, ctx.today);
    const from = addSchoolDays(ctx.today, -(q.days - 1));
    const tracked = await this.trackedDates(from, ctx.today);
    const now = new Date();
    const trend: AttendanceSummaryDto["trend"] = [];
    let today: AttendanceSummaryDto["today"] | null = null;
    for (const date of eachSchoolDate(from, ctx.today)) {
      const isToday = date === ctx.today;
      if (!isToday && !tracked.has(date)) continue;
      const { schoolDay, rows } = await this.dayCounts(date, ctx, student, tracked.has(date), now);
      const counts = countBy(rows.map((r) => r.status));
      const item = { date, expected: rows.length, counts, rate: attendanceRate(counts) };
      if (rows.length > 0 && tracked.has(date)) trend.push(item);
      if (isToday) {
        const classes = new Map<string, { className: string; statuses: SchoolAttendanceStatusDto[] }>();
        for (const r of rows) {
          const c = classes.get(r.day.classGroupId) ?? { className: r.day.className, statuses: [] };
          c.statuses.push(r.status);
          classes.set(r.day.classGroupId, c);
        }
        today = {
          ...item,
          schoolDay,
          byClass: [...classes]
            .map(([classGroupId, c]) => {
              const cc = countBy(c.statuses);
              return {
                classGroupId,
                className: c.className,
                expected: c.statuses.length,
                counts: cc,
                rate: attendanceRate(cc),
              };
            })
            .sort((a, b) => a.className.localeCompare(b.className, "uz", { numeric: true })),
        };
      }
    }
    return { today: today!, trend };
  }

  /** Staff (attendance.view, in scope), the student themself or their guardian. */
  async student(
    auth: RequestAuth,
    studentId: string,
    q: z.infer<typeof StudentAttendanceQuerySchema>,
  ): Promise<StudentAttendanceDto> {
    const ctx = await this.ctx();
    const scope = await resolveScope(this.db, auth, ctx.tz);
    const visible = await this.db.student.findFirst({
      where: { AND: [{ id: studentId }, attendanceStudentWhere(scope, ctx.today)] },
      select: { id: true },
    });
    if (!visible) throw notFound();
    const to = q.to ?? ctx.today;
    const from = q.from ?? addSchoolDays(to, -29);
    if (diffSchoolDays(from, to) < 0 || diffSchoolDays(from, to) > MAX_RANGE_DAYS) {
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "from", code: "range" }] });
    }
    const records = await this.db.attendanceRecord.findMany({
      where: { studentId, schoolDate: { gte: schoolDateToDb(from), lte: schoolDateToDb(to) } },
      select: recordSelect,
    });
    const recOf = new Map(records.map((r) => [schoolDateFromDb(r.schoolDate), r]));
    const tracked = await this.trackedDates(from, to);
    const now = new Date();
    const days: StudentAttendanceDto["days"] = [];
    for (const date of eachSchoolDate(from, to)) {
      if (date > ctx.today) break;
      const day = (await studentDays(this.db, date, ctx, { studentIds: [studentId] })).get(studentId);
      const rec = recOf.get(date);
      // Days without a class or off for the grade are skipped unless something was recorded.
      if (!rec && (!day || !day.expected)) continue;
      // Nothing was recorded at school that day: not an absence, just no data (today is still open).
      if (!rec && !tracked.has(date) && date !== ctx.today) continue;
      const rules = day ?? {
        rules: {
          schoolDate: date,
          startMinute: ctx.settings.defaultStartMinute,
          endMinute: ctx.settings.defaultEndMinute,
          graceMinutes: ctx.settings.graceMinutes,
          bands: ctx.bands,
          tz: ctx.tz,
        },
      };
      const f = dayFields(rec, rules, now, tracked.has(date));
      days.push({
        date,
        status: f.status,
        firstInAt: f.firstInAt,
        lastOutAt: f.lastOutAt,
        lateMinutes: f.lateMinutes,
        latenessBandName: f.latenessBandName,
        earlyLeaveMinutes: f.earlyLeaveMinutes,
        manualStatus: f.manualStatus,
        manualReason: f.manualReason,
      });
    }
    days.reverse();
    return { studentId, from, to, days, counts: countBy(days.map((d) => d.status)) };
  }

  /** A manual mark (device down, forgotten face, excused absence). Not in the future. */
  async mark(auth: RequestAuth, studentId: string, date: SchoolDate, input: z.infer<typeof ManualMarkSchema>) {
    const ctx = await this.ctx();
    if (date > ctx.today) throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "date", code: "future" }] });
    const scope = await resolveScope(this.db, auth, ctx.tz);
    const visible = await this.db.student.findFirst({
      where: { AND: [{ id: studentId }, attendanceStudentWhere(scope, ctx.today)] },
      select: { id: true },
    });
    if (!visible) throw notFound();
    const d = schoolDateToDb(date);
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance:${requireTenantId()}:${studentId}:${date}`}, 0))`;
      const key = { tenantId_studentId_schoolDate: { tenantId: requireTenantId(), studentId, schoolDate: d } };
      const before = await tx.attendanceRecord.findUnique({
        where: key,
        select: { manualStatus: true, manualReason: true },
      });
      const manual = {
        manualStatus: input.status,
        manualReason: input.reason,
        manualById: auth.userId,
        manualAt: new Date(),
      };
      await tx.attendanceRecord.upsert({
        where: key,
        create: { tenantId: requireTenantId(), studentId, schoolDate: d, ...manual },
        update: manual,
      });
      await writeAudit(tx, {
        action: "attendance.mark",
        entityType: "AttendanceRecord",
        entityId: `${studentId}:${date}`,
        before,
        after: { manualStatus: input.status },
        reason: input.reason,
      });
    });
    return this.student(auth, studentId, { from: date, to: date });
  }

  async clearMark(auth: RequestAuth, studentId: string, date: SchoolDate, reason: string) {
    const ctx = await this.ctx();
    const scope = await resolveScope(this.db, auth, ctx.tz);
    const visible = await this.db.student.findFirst({
      where: { AND: [{ id: studentId }, attendanceStudentWhere(scope, ctx.today)] },
      select: { id: true },
    });
    if (!visible) throw notFound();
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance:${requireTenantId()}:${studentId}:${date}`}, 0))`;
      const rec = await tx.attendanceRecord.findUnique({
        where: {
          tenantId_studentId_schoolDate: { tenantId: requireTenantId(), studentId, schoolDate: schoolDateToDb(date) },
        },
        select: { id: true, deviceStatus: true, manualStatus: true, manualReason: true },
      });
      if (!rec?.manualStatus) throw notFound();
      if (rec.deviceStatus) {
        await tx.attendanceRecord.update({
          where: { id: rec.id },
          data: { manualStatus: null, manualReason: null, manualById: null, manualAt: null },
        });
      } else {
        await tx.attendanceRecord.delete({ where: { id: rec.id } });
      }
      await writeAudit(tx, {
        action: "attendance.clear_mark",
        entityType: "AttendanceRecord",
        entityId: `${studentId}:${date}`,
        before: { manualStatus: rec.manualStatus, manualReason: rec.manualReason },
        reason,
      });
    });
    return this.student(auth, studentId, { from: date, to: date });
  }

  async events(q: z.infer<typeof AccessEventQuerySchema>) {
    const { today } = await schoolClock(this.db);
    const where: Prisma.AccessEventWhereInput = {
      schoolDate: schoolDateToDb(q.date ?? today),
      ...(q.deviceId ? { deviceId: q.deviceId } : {}),
      ...(q.unmatched === "true" ? { studentId: null } : {}),
      ...(q.q ? { employeeNo: { contains: q.q, mode: "insensitive" as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.accessEvent.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          deviceId: true,
          device: { select: { name: true } },
          occurredAt: true,
          employeeNo: true,
          studentId: true,
          student: { select: { firstName: true, lastName: true } },
          direction: true,
          source: true,
        },
      }),
      this.db.accessEvent.count({ where }),
    ]);
    const items: AccessEventDto[] = rows.map((e) => ({
      id: e.id,
      deviceId: e.deviceId,
      deviceName: e.device.name,
      occurredAt: e.occurredAt.toISOString(),
      employeeNo: e.employeeNo,
      studentId: e.studentId,
      studentName: e.student ? `${e.student.lastName} ${e.student.firstName}` : null,
      direction: e.direction,
      source: e.source,
    }));
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async monitoring(): Promise<AttendanceMonitoringDto> {
    const [settings, { today }] = await Promise.all([attendanceSettings(this.db), schoolClock(this.db)]);
    const d = schoolDateToDb(today);
    const [devices, bridges, eventsToday, unmatchedToday, faceStates, students, withPhoto, failedJobs] =
      await Promise.all([
        this.db.device.findMany({ where: { archivedAt: null, isActive: true }, select: { lastSeenAt: true } }),
        this.db.bridgeAgent.findMany({ where: { isActive: true }, select: { lastSeenAt: true } }),
        this.db.accessEvent.count({ where: { schoolDate: d } }),
        this.db.accessEvent.count({ where: { schoolDate: d, studentId: null } }),
        this.db.faceSyncJob.groupBy({
          by: ["studentId", "status"],
          where: { action: "UPSERT", device: { archivedAt: null, isActive: true } },
        }),
        this.db.student.count({ where: { status: "ACTIVE" } }),
        this.db.faceProfile.count({ where: { photoAssetId: { not: null }, student: { status: "ACTIVE" } } }),
        this.db.bridgeJob.count({ where: { status: "FAILED", createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
      ]);
    const now = new Date();
    const health = (rows: { lastSeenAt: Date | null }[]) => {
      const s = rows.map((r) => connectionStatus(r.lastSeenAt, now, settings.deviceStaleSeconds));
      return {
        online: s.filter((x) => x === "ONLINE").length,
        offline: s.filter((x) => x === "OFFLINE").length,
        unknown: s.filter((x) => x === "UNKNOWN").length,
      };
    };
    const worst = new Map<string, string>();
    const rank = { FAILED: 3, PENDING: 2, IN_PROGRESS: 2, SYNCED: 1 } as const;
    for (const f of faceStates) {
      const prev = worst.get(f.studentId);
      if (!prev || rank[f.status] > rank[prev as keyof typeof rank]) worst.set(f.studentId, f.status);
    }
    const w = [...worst.values()];
    return {
      date: today,
      devices: health(devices),
      bridges: health(bridges),
      eventsToday,
      unmatchedToday,
      faces: {
        none: Math.max(0, students - withPhoto),
        synced: w.filter((x) => x === "SYNCED").length,
        pending: w.filter((x) => x === "PENDING" || x === "IN_PROGRESS").length,
        failed: w.filter((x) => x === "FAILED").length,
      },
      failedJobs,
    };
  }
}

// Reports centre (audit phase 6): Excel files over a school-date range. Every number comes from the same services
// the pages use (attendance statuses, staff day, ledgers), so a report never disagrees with the screen. Ledger rows
// (scores, coins) are listed as they are, reversals included — nothing is netted away silently.
import ExcelJS from "exceljs";
import type { z } from "zod";
import type { Db, Prisma } from "@idrok/db";
import { importLabelsRu, importLabelsUz, type ReportRangeQuerySchema } from "@idrok/shared";
import { diffSchoolDays, eachSchoolDate, schoolDateFromDb, schoolDateToDb } from "@idrok/shared/time";
import { attendanceRate } from "../../domain/attendance";
import type { RequestAuth } from "../../http/auth";
import { AppError } from "../../http/errors";
import { resolveScope, studentWhere } from "../access/scope";
import { schoolClock } from "../access/school-clock";
import { AttendanceService } from "../attendance/attendance.service";
import { StaffAttendanceService } from "../attendance/staff-attendance.service";

type Query = z.infer<typeof ReportRangeQuerySchema>;
const MAX_DAYS = { attendance: 92, ledger: 366 } as const;

const labels = (locale: "uz" | "ru") => (locale === "ru" ? importLabelsRu : importLabelsUz).reports;

function checkRange(q: Query, max: number) {
  const days = diffSchoolDays(q.from, q.to);
  if (days < 0 || days > max)
    throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "to", code: "range_too_long" }] });
}

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; width: number }[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

/** "08:25" in the school time zone, or "". */
const timeOf = (iso: string | null, tz: string) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(
        new Date(iso),
      )
    : "";

const percentCell = (rate: string | null) => (rate === null ? "" : Number(rate));

export class ReportsService {
  constructor(private readonly db: Db) {}

  /** Students × school days: a summary sheet (counts and rate) and every day's status. */
  async attendance(auth: RequestAuth, q: Query): Promise<Buffer> {
    checkRange(q, MAX_DAYS.attendance);
    const L = labels(q.locale);
    const { timezone } = await schoolClock(this.db);
    const { rows, students } = await new AttendanceService(this.db).rangeRows(auth, q.from, q.to, q.classGroupId);
    const name = (id: string) => {
      const s = students.get(id);
      return s ? `${s.lastName} ${s.firstName}` : "";
    };
    const wb = new ExcelJS.Workbook();
    const summary = sheet(wb, L.summary, [
      { header: L.student, width: 32 },
      { header: L.code, width: 14 },
      { header: L.className, width: 10 },
      ...(["PRESENT", "LATE", "ABSENT", "EXCUSED", "NO_DATA"] as const).map((s) => ({
        header: L.statuses[s],
        width: 12,
      })),
      { header: L.rate, width: 14 },
    ]);
    const byStudent = new Map<string, { className: string; counts: Record<string, number> }>();
    for (const r of rows) {
      const x = byStudent.get(r.studentId) ?? { className: r.className, counts: {} };
      x.counts[r.status] = (x.counts[r.status] ?? 0) + 1;
      byStudent.set(r.studentId, x);
    }
    const ordered = [...byStudent].sort(
      ([a, x], [b, y]) =>
        x.className.localeCompare(y.className, "uz", { numeric: true }) || name(a).localeCompare(name(b), "uz"),
    );
    for (const [id, x] of ordered)
      summary.addRow([
        name(id),
        students.get(id)?.studentCode ?? "",
        x.className,
        x.counts.PRESENT ?? 0,
        x.counts.LATE ?? 0,
        x.counts.ABSENT ?? 0,
        x.counts.EXCUSED ?? 0,
        x.counts.NO_DATA ?? 0,
        percentCell(attendanceRate(x.counts)),
      ]);
    const days = sheet(wb, L.days, [
      { header: L.date, width: 12 },
      { header: L.student, width: 32 },
      { header: L.className, width: 10 },
      { header: L.status, width: 16 },
      { header: L.arrived, width: 10 },
      { header: L.left, width: 10 },
      { header: L.lateMinutes, width: 16 },
      { header: L.earlyLeaveMinutes, width: 18 },
    ]);
    for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.className.localeCompare(b.className)))
      days.addRow([
        r.date,
        name(r.studentId),
        r.className,
        L.statuses[r.status],
        timeOf(r.firstInAt, timezone),
        timeOf(r.lastOutAt, timezone),
        r.lateMinutes || "",
        r.earlyLeaveMinutes || "",
      ]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Staff × working days (T-76, T-86). */
  async staffAttendance(q: Query): Promise<Buffer> {
    checkRange(q, MAX_DAYS.attendance);
    const L = labels(q.locale);
    const { timezone } = await schoolClock(this.db);
    const staff = new StaffAttendanceService(this.db);
    const wb = new ExcelJS.Workbook();
    const ws = sheet(wb, L.days, [
      { header: L.date, width: 12 },
      { header: L.employee, width: 32 },
      { header: L.position, width: 20 },
      { header: L.status, width: 16 },
      { header: L.arrived, width: 10 },
      { header: L.left, width: 10 },
      { header: L.lateMinutes, width: 16 },
      { header: L.earlyLeaveMinutes, width: 18 },
    ]);
    for (const date of eachSchoolDate(q.from, q.to)) {
      const day = await staff.day({ date, page: 1, pageSize: 10_000 });
      if (!day.workingDay && day.items.length === 0) continue;
      for (const r of day.items)
        ws.addRow([
          date,
          `${r.lastName} ${r.firstName}`,
          r.positionTitle ?? "",
          L.statuses[r.status],
          timeOf(r.firstInAt, timezone),
          timeOf(r.lastOutAt, timezone),
          r.lateMinutes || "",
          r.earlyLeaveMinutes || "",
        ]);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Score ledger rows in the range, in the caller's data scope (reversals are their own rows). */
  async scores(auth: RequestAuth, q: Query): Promise<Buffer> {
    checkRange(q, MAX_DAYS.ledger);
    const L = labels(q.locale);
    const { timezone, today } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    const where: Prisma.ScoreEntryWhereInput = {
      schoolDate: { gte: schoolDateToDb(q.from), lte: schoolDateToDb(q.to) },
      student: {
        ...studentWhere(scope, today),
        ...(q.classGroupId ? { enrollments: { some: { classGroupId: q.classGroupId } } } : {}),
      },
    };
    const rows = await this.db.scoreEntry.findMany({
      where,
      orderBy: [{ schoolDate: "asc" }, { createdAt: "asc" }],
      select: {
        schoolDate: true,
        points: true,
        kind: true,
        note: true,
        reason: true,
        student: { select: { studentCode: true, firstName: true, lastName: true } },
        teachingGroup: { select: { name: true } },
        subject: { select: { name: true } },
        teacher: { select: { firstName: true, lastName: true } },
        criterion: { select: { name: true } },
      },
    });
    const wb = new ExcelJS.Workbook();
    const ws = sheet(wb, L.days, [
      { header: L.date, width: 12 },
      { header: L.student, width: 32 },
      { header: L.code, width: 14 },
      { header: L.className, width: 14 },
      { header: L.subject, width: 20 },
      { header: L.teacher, width: 26 },
      { header: L.criterion, width: 18 },
      { header: L.points, width: 8 },
      { header: L.kind, width: 14 },
      { header: L.note, width: 30 },
    ]);
    for (const r of rows)
      ws.addRow([
        schoolDateFromDb(r.schoolDate),
        `${r.student.lastName} ${r.student.firstName}`,
        r.student.studentCode,
        r.teachingGroup.name,
        r.subject.name,
        `${r.teacher.lastName} ${r.teacher.firstName}`,
        r.criterion?.name ?? "",
        Number(r.points.toString()),
        L.scoreKinds[r.kind],
        r.reason ?? r.note ?? "",
      ]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Coin ledger rows in the range (the whole school: coins.view). */
  async coins(q: Query): Promise<Buffer> {
    checkRange(q, MAX_DAYS.ledger);
    const L = labels(q.locale);
    const rows = await this.db.coinTransaction.findMany({
      where: {
        schoolDate: { gte: schoolDateToDb(q.from), lte: schoolDateToDb(q.to) },
        ...(q.classGroupId ? { student: { enrollments: { some: { classGroupId: q.classGroupId } } } } : {}),
      },
      orderBy: [{ schoolDate: "asc" }, { createdAt: "asc" }],
      select: {
        schoolDate: true,
        type: true,
        source: true,
        amount: true,
        balanceAfter: true,
        criterionNameSnapshot: true,
        reason: true,
        student: { select: { studentCode: true, firstName: true, lastName: true } },
        teacher: { select: { firstName: true, lastName: true } },
      },
    });
    const wb = new ExcelJS.Workbook();
    const ws = sheet(wb, L.days, [
      { header: L.date, width: 12 },
      { header: L.student, width: 32 },
      { header: L.code, width: 14 },
      { header: L.type, width: 16 },
      { header: L.source, width: 18 },
      { header: L.criterion, width: 18 },
      { header: L.teacher, width: 26 },
      { header: L.amount, width: 10 },
      { header: L.balanceAfter, width: 10 },
      { header: L.reason, width: 30 },
    ]);
    for (const r of rows)
      ws.addRow([
        schoolDateFromDb(r.schoolDate),
        `${r.student.lastName} ${r.student.firstName}`,
        r.student.studentCode,
        L.coinTypes[r.type],
        L.coinSources[r.source],
        r.criterionNameSnapshot ?? "",
        r.teacher ? `${r.teacher.lastName} ${r.teacher.firstName}` : "",
        r.amount,
        r.balanceAfter,
        r.reason ?? "",
      ]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}

// Who is expected at school on a day and with which times: the student's class on that day (enrollment), the class's
// shift (else the school default) and the school calendar (working weekdays, holidays per grade).
import type { Db, DbTransaction, Prisma } from "@idrok/db";
import { atSchoolTime, eachSchoolDate, schoolDateFromDb, schoolDateToDb, type SchoolDate } from "@idrok/shared/time";
import type { DayRules, LatenessBand } from "../../domain/attendance";
import { lessonWeekday, type CalendarDayInput } from "../../domain/lessons";
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
  return (await studentDaysRange(db, date, date, ctx, where)).get(date) ?? new Map();
}

/**
 * `studentDays` for every day of [from, to] with three queries in all (enrollments, school weeks, calendar marks)
 * instead of three per day — the history, the dashboard trend and the Excel report read ranges.
 */
export async function studentDaysRange(
  db: Db | DbTransaction,
  from: SchoolDate,
  to: SchoolDate,
  ctx: { settings: Settings; bands: LatenessBand[]; tz: string },
  where: { studentIds?: string[]; student?: Prisma.StudentWhereInput } = {},
): Promise<Map<SchoolDate, Map<string, StudentDay>>> {
  const fromDb = schoolDateToDb(from);
  const toDb = schoolDateToDb(to);
  const enrollments = await db.studentEnrollment.findMany({
    where: {
      validFrom: { lte: toDb },
      OR: [{ validTo: null }, { validTo: { gte: fromDb } }],
      status: { not: "CANCELLED" },
      ...(where.studentIds ? { studentId: { in: where.studentIds } } : {}),
      student: { status: "ACTIVE", ...where.student },
    },
    orderBy: { validFrom: "desc" },
    select: {
      studentId: true,
      academicYearId: true,
      validFrom: true,
      validTo: true,
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
      where: { academicYearId: { in: yearIds }, date: { gte: fromDb, lte: toDb } },
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
    const date = schoolDateFromDb(m.date);
    const ofYear = markOf.get(m.academicYearId) ?? new Map<string, CalendarDayInput>();
    ofYear.set(date, {
      date,
      kind: m.kind,
      followsWeekday: m.followsWeekday,
      gradeIds: m.appliesToAll ? null : m.grades.map((g) => g.gradeId),
    });
    markOf.set(m.academicYearId, ofYear);
  }
  const out = new Map<SchoolDate, Map<string, StudentDay>>();
  for (const date of eachSchoolDate(from, to)) {
    const d = schoolDateToDb(date);
    const day = new Map<string, StudentDay>();
    for (const e of enrollments) {
      if (e.validFrom > d || (e.validTo !== null && e.validTo < d)) continue;
      if (day.has(e.studentId)) continue; // newest enrollment wins on a transfer day
      const working = weekdays.get(e.academicYearId) ?? new Set(DEFAULT_WORKING_WEEKDAYS);
      const expected =
        lessonWeekday(date, e.classGroup.gradeId, working, markOf.get(e.academicYearId) ?? new Map()) !== null;
      day.set(e.studentId, {
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
    out.set(date, day);
  }
  return out;
}

/**
 * Q-55 (T-86): whether the staff work on `date`, from the school calendar of the academic year holding the date —
 * its working weekdays and the school-wide marks (a mark for some grades only does not stop the staff). Student
 * vacations are working days for the staff. Outside any academic year the default working week applies.
 */
export async function staffWorkingDay(db: Db | DbTransaction, date: SchoolDate): Promise<boolean> {
  const d = schoolDateToDb(date);
  const year = await db.academicYear.findFirst({
    where: { startDate: { lte: d }, endDate: { gte: d } },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      schoolWeek: { select: { workingWeekdays: true } },
      calendarDays: {
        where: { date: d, appliesToAll: true },
        select: { date: true, kind: true, followsWeekday: true },
      },
    },
  });
  const working = new Set(year?.schoolWeek?.workingWeekdays ?? DEFAULT_WORKING_WEEKDAYS);
  const marks = new Map<string, CalendarDayInput>(
    (year?.calendarDays ?? [])
      .filter((m) => m.kind !== "VACATION")
      .map((m) => [date, { date, kind: m.kind, followsWeekday: m.followsWeekday, gradeIds: null }]),
  );
  return lessonWeekday(date, null, working, marks) !== null;
}

/** "+05:00": the school time zone's UTC offset on a day (terminals take local times with an offset). */
export function offsetOf(day: SchoolDate, tz: string): string {
  const minutes = Math.round((schoolDateToDb(day).getTime() - atSchoolTime(day, 0, tz).getTime()) / 60_000);
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  return `${minutes < 0 ? "-" : "+"}${hh}:${String(abs % 60).padStart(2, "0")}`;
}

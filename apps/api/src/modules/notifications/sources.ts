// What produces guardian notifications (T-94): school arrival/departure, the daily digest of scores and coins, low
// attendance and closed tests. Every producer is idempotent through the notification's dedupeKey.
import { requireTenantId, type Db, type DbTransaction } from "@idrok/db";
import { D, roundTo, toDecimalString } from "@idrok/shared/decimal";
import {
  addSchoolDays,
  formatTimeOfDay,
  isoWeekday,
  schoolDateFromDb,
  schoolDateToDb,
  schoolMinuteOfDay,
  type SchoolDate,
} from "@idrok/shared/time";
import { attendanceRate, isBelowThreshold } from "../../domain/notifications";
import { testWindowClosed } from "../../domain/tests";
import { schoolClock } from "../access/school-clock";
import { activeBands, attendanceSettings } from "../attendance/attendance-config.service";
import { studentDaysRange } from "../attendance/school-day";
import { notifyStudentGuardians, schoolAllows } from "./fanout";
import { notificationSettings } from "./settings";

const fullName = (s: { firstName: string; lastName: string }) => `${s.lastName} ${s.firstName}`;
const ONE_DECIMAL = { mode: "HALF_UP", decimals: 1 } as const;

// ---- arrival and departure (from the attendance recompute, in its transaction)

/**
 * Called by recomputeDay with the record before and after: a first arrival today → notify now; a new last exit →
 * notify after the delay (a later exit moves it). Events only — the worker decides who gets what.
 */
export async function emitAttendanceEvents(
  tx: DbTransaction,
  input: {
    studentId: string;
    date: SchoolDate;
    today: SchoolDate;
    departureDelayMinutes: number;
    before: { firstInAt: Date | null; lastOutAt: Date | null } | null;
    after: { firstInAt: Date | null; lastOutAt: Date | null };
  },
): Promise<void> {
  if (input.date !== input.today) return;
  const tenantId = requireTenantId();
  const payload = { tenantId, studentId: input.studentId, schoolDate: input.date };
  const events: { type: string; availableAt: Date }[] = [];
  if (input.after.firstInAt && !input.before?.firstInAt)
    events.push({ type: "notify.arrival", availableAt: new Date() });
  const out = input.after.lastOutAt;
  if (out && out.getTime() !== input.before?.lastOutAt?.getTime())
    events.push({
      type: "notify.departure",
      availableAt: new Date(Math.max(Date.now(), out.getTime()) + input.departureDelayMinutes * 60_000),
    });
  if (!events.length) return;
  await tx.outboxEvent.createMany({
    data: events.map((e) => ({
      tenantId,
      type: e.type,
      aggregateType: "Student",
      aggregateId: input.studentId,
      payload,
      availableAt: e.availableAt,
    })),
  });
}

async function studentName(db: Db | DbTransaction, studentId: string) {
  const s = await db.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true } });
  return s ? fullName(s) : null;
}

export async function processArrival(db: Db, studentId: string, date: SchoolDate): Promise<number> {
  const [settings, { timezone }] = await Promise.all([notificationSettings(db), schoolClock(db)]);
  if (!schoolAllows(settings, "ARRIVAL")) return 0;
  const record = await db.attendanceRecord.findUnique({
    where: {
      tenantId_studentId_schoolDate: { tenantId: requireTenantId(), studentId, schoolDate: schoolDateToDb(date) },
    },
    select: { firstInAt: true, lateMinutes: true, deviceStatus: true },
  });
  const student = await studentName(db, studentId);
  if (!record?.firstInAt || !student) return 0;
  const params = {
    student,
    time: formatTimeOfDay(schoolMinuteOfDay(record.firstInAt, timezone)),
    late: record.deviceStatus === "LATE" ? record.lateMinutes : 0,
  };
  return db.$transaction((tx) =>
    notifyStudentGuardians(tx, {
      kind: "ARRIVAL",
      studentId,
      dedupeKey: `arrival:${studentId}:${date}`,
      params,
      settings,
      tz: timezone,
    }),
  );
}

export async function processDeparture(db: Db, studentId: string, date: SchoolDate, now = new Date()): Promise<number> {
  const [settings, { timezone }] = await Promise.all([notificationSettings(db), schoolClock(db)]);
  if (!schoolAllows(settings, "DEPARTURE")) return 0;
  const record = await db.attendanceRecord.findUnique({
    where: {
      tenantId_studentId_schoolDate: { tenantId: requireTenantId(), studentId, schoolDate: schoolDateToDb(date) },
    },
    select: { lastOutAt: true },
  });
  const student = await studentName(db, studentId);
  if (!record?.lastOutAt || !student) return 0;
  // A later exit was recorded after this event was scheduled: its own (later) event will report it.
  if (record.lastOutAt.getTime() + settings.departureDelayMinutes * 60_000 > now.getTime() + 1_000) return 0;
  return db.$transaction((tx) =>
    notifyStudentGuardians(tx, {
      kind: "DEPARTURE",
      studentId,
      dedupeKey: `departure:${studentId}:${date}`,
      params: { student, time: formatTimeOfDay(schoolMinuteOfDay(record.lastOutAt!, timezone)) },
      settings,
      tz: timezone,
    }),
  );
}

// ---- daily digest of scores and coins (Q-56: a digest, not one message per score)

/** Today's digest, once the digest time has come. Returns the number of notifications created. */
export async function sendDailyDigests(db: Db, now = new Date()): Promise<number> {
  const [settings, { timezone, today }] = await Promise.all([notificationSettings(db), schoolClock(db)]);
  if (!schoolAllows(settings, "DAILY_DIGEST")) return 0;
  if (schoolMinuteOfDay(now, timezone) < settings.digestMinute) return 0;
  const day = schoolDateToDb(today);
  const [scores, coins] = await Promise.all([
    db.scoreEntry.groupBy({
      by: ["studentId", "subjectId", "kind"],
      where: { schoolDate: day },
      _sum: { points: true },
      _count: { _all: true },
    }),
    db.coinTransaction.groupBy({ by: ["studentId"], where: { schoolDate: day }, _sum: { amount: true } }),
  ]);
  const studentIds = [...new Set([...scores.map((s) => s.studentId), ...coins.map((c) => c.studentId)])];
  if (!studentIds.length) return 0;
  const [students, subjects, balances] = await Promise.all([
    db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, firstName: true, lastName: true } }),
    db.subject.findMany({
      where: { id: { in: [...new Set(scores.map((s) => s.subjectId))] } },
      select: { id: true, name: true },
    }),
    db.coinAccount.findMany({ where: { studentId: { in: studentIds } }, select: { studentId: true, balance: true } }),
  ]);
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  const balanceOf = new Map(balances.map((b) => [b.studentId, b.balance]));
  const coinDelta = new Map(coins.map((c) => [c.studentId, c._sum.amount ?? 0]));
  let created = 0;
  for (const s of students) {
    const mine = scores.filter((e) => e.studentId === s.id);
    // A reversal cancels a score: count = given − reversed; totals are the net of both.
    const count = mine.reduce((n, e) => n + (e.kind === "REVERSAL" ? -e._count._all : e._count._all), 0);
    const bySubject = new Map<string, ReturnType<typeof D>>();
    for (const e of mine)
      bySubject.set(e.subjectId, (bySubject.get(e.subjectId) ?? D(0)).plus(e._sum.points?.toString() ?? "0"));
    const total = [...bySubject.values()].reduce((a, b) => a.plus(b), D(0));
    const delta = coinDelta.get(s.id);
    if (count <= 0 && !delta) continue;
    const params = {
      student: fullName(s),
      date: today,
      scoreCount: Math.max(0, count),
      scoreTotal: toDecimalString(total),
      subjects: [...bySubject.entries()]
        .filter(([, v]) => !v.isZero())
        .map(([id, v]) => ({ name: subjectName.get(id) ?? "", total: toDecimalString(v) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      coinDelta: delta ?? null,
      coinBalance: balanceOf.get(s.id) ?? 0,
    };
    created += await db.$transaction((tx) =>
      notifyStudentGuardians(tx, {
        kind: "DAILY_DIGEST",
        studentId: s.id,
        dedupeKey: `digest:${s.id}:${today}`,
        params,
        settings,
        tz: timezone,
        at: now,
      }),
    );
  }
  return created;
}

// ---- low attendance (weekly, on Mondays)

/** Mondays: students whose attendance over the window is below the threshold, once per week. */
export async function sendLowAttendanceAlerts(db: Db, now = new Date()): Promise<number> {
  const [settings, { timezone, today }, attendance] = await Promise.all([
    notificationSettings(db),
    schoolClock(db),
    attendanceSettings(db),
  ]);
  if (!schoolAllows(settings, "LOW_ATTENDANCE") || !attendance.isEnabled) return 0;
  if (isoWeekday(today) !== 1 || schoolMinuteOfDay(now, timezone) < 9 * 60) return 0;
  const to = addSchoolDays(today, -1);
  const from = addSchoolDays(today, -settings.lowAttendanceWindowDays);
  const days = await studentDaysRange(db, from, to, {
    settings: attendance,
    bands: await activeBands(db),
    tz: timezone,
  });
  const expected = new Map<string, number>();
  const expectedDays = new Map<string, Set<string>>();
  for (const [date, byStudent] of days)
    for (const d of byStudent.values())
      if (d.expected) {
        expected.set(d.studentId, (expected.get(d.studentId) ?? 0) + 1);
        if (!expectedDays.has(d.studentId)) expectedDays.set(d.studentId, new Set());
        expectedDays.get(d.studentId)!.add(date);
      }
  if (!expected.size) return 0;
  const records = await db.attendanceRecord.findMany({
    where: {
      studentId: { in: [...expected.keys()] },
      schoolDate: { gte: schoolDateToDb(from), lte: schoolDateToDb(to) },
    },
    select: { studentId: true, schoolDate: true, deviceStatus: true, manualStatus: true },
  });
  const attended = new Map<string, number>();
  for (const r of records) {
    const status = r.manualStatus ?? r.deviceStatus;
    if (
      (status === "PRESENT" || status === "LATE") &&
      expectedDays.get(r.studentId)?.has(schoolDateFromDb(r.schoolDate))
    )
      attended.set(r.studentId, (attended.get(r.studentId) ?? 0) + 1);
  }
  const low = [...expected.entries()].filter(
    // Too few school days say nothing (a new student, the first week of the year).
    ([id, n]) => n >= 5 && isBelowThreshold(attendanceRate(n, attended.get(id) ?? 0), settings.lowAttendanceThreshold),
  );
  if (!low.length) return 0;
  const students = await db.student.findMany({
    where: { id: { in: low.map(([id]) => id) } },
    select: { id: true, firstName: true, lastName: true },
  });
  let created = 0;
  for (const s of students) {
    const n = expected.get(s.id)!;
    const a = attended.get(s.id) ?? 0;
    created += await db.$transaction((tx) =>
      notifyStudentGuardians(tx, {
        kind: "LOW_ATTENDANCE",
        studentId: s.id,
        dedupeKey: `low_attendance:${s.id}:${today}`,
        params: {
          student: fullName(s),
          days: settings.lowAttendanceWindowDays,
          rate: toDecimalString(roundTo(attendanceRate(n, a)!, ONE_DECIMAL)),
          attended: a,
          expected: n,
        },
        settings,
        tz: timezone,
        at: now,
      }),
    );
  }
  return created;
}

// ---- test results (when the window is over)

/** The test's results once the student may see them (S4: the total only, never answers). */
export async function notifyTestResults(db: Db, testId: string, now = new Date()): Promise<number> {
  const [settings, { timezone }] = await Promise.all([notificationSettings(db), schoolClock(db)]);
  if (!schoolAllows(settings, "TEST_RESULT")) return 0;
  const test = await db.test.findUnique({
    where: { id: testId },
    select: {
      title: true,
      status: true,
      endsAt: true,
      retakePolicy: true,
      showResultToStudent: true,
      subject: { select: { name: true } },
      overrides: { select: { endsAt: true } },
    },
  });
  if (!test || test.showResultToStudent === "NEVER") return 0;
  const closed = testWindowClosed({
    testClosed: test.status === "CLOSED",
    endsAt: test.endsAt,
    overrideEnds: test.overrides.map((o) => o.endsAt),
    now,
  });
  if (!closed) return 0;
  const attempts = await db.testAttempt.findMany({
    where: { testId, status: "FINISHED" },
    orderBy: { finishedAt: "asc" },
    select: {
      studentId: true,
      score: true,
      maxScore: true,
      percent: true,
      student: { select: { firstName: true, lastName: true } },
    },
  });
  const chosen = new Map<string, (typeof attempts)[number]>();
  for (const a of attempts) {
    const prev = chosen.get(a.studentId);
    const better =
      !prev || test.retakePolicy !== "BEST" || D(a.percent?.toString() ?? 0).gt(prev.percent?.toString() ?? 0);
    if (better) chosen.set(a.studentId, a);
  }
  let created = 0;
  for (const [studentId, a] of chosen) {
    const { score, maxScore } = a;
    if (score === null || maxScore === null) continue;
    created += await db.$transaction((tx) =>
      notifyStudentGuardians(tx, {
        kind: "TEST_RESULT",
        studentId,
        dedupeKey: `test:${testId}:${studentId}`,
        params: {
          student: fullName(a.student),
          test: test.title,
          subject: test.subject.name,
          score: toDecimalString(score.toString()),
          max: toDecimalString(maxScore.toString()),
          percent: a.percent === null ? "0" : toDecimalString(roundTo(a.percent.toString(), ONE_DECIMAL)),
        },
        settings,
        tz: timezone,
        at: now,
      }),
    );
  }
  return created;
}

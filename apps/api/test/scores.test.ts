// M3 step 3: scores on lessons — scoring.md §11 acceptance 17–24 (24's FINAL-result part is in the period-closing
// test), attendance, reversals and the lesson journal.
import { randomUUID } from "node:crypto";
import { addSchoolDays, diffSchoolDays, schoolDateFromDb, schoolToday } from "@idrok/shared/time";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
const today = schoolToday("Asia/Tashkent");
const yearPath = () => `/academic-years/${s.year.id}`;
/** Lessons of 7-A on the latest past school day: maths 1–4 (teacher 1), English 5–8 (teacher 2). */
let day: { maths: string[]; english: string[]; date: string };
let yearPeriodId: string;

const score = (who: Record<string, string>, lessonSessionId: string, points: number | string, extra = {}) =>
  api(t, who).raw("post", "/scores", {
    idempotencyKey: randomUUID(),
    lessonSessionId,
    studentId: s.s7a.id,
    points,
    ...extra,
  });

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  await s.a.post("/teacher-assignments", {
    teacherId: s.emp2.id,
    teachingGroupId: s.c7a.classTeachingGroupId,
    subjectId: s.english.id,
    validFrom: "2026-09-01",
  });
  const year = await s.a.post(`${yearPath()}/periods`, {
    type: "YEAR",
    name: "Yil",
    order: 1,
    startDate: "2026-09-01",
    endDate: "2027-06-30",
  });
  yearPeriodId = year.id;
  await s.a.post(`${yearPath()}/bell-schedules`, {
    name: "Asosiy",
    validFrom: "2026-09-01",
    slots: Array.from({ length: 8 }, (_, i) => ({
      lessonNumber: i + 1,
      startTime: `${String(8 + i).padStart(2, "0")}:00`,
      endTime: `${String(8 + i).padStart(2, "0")}:45`,
    })),
  });
  const tt = await s.a.post(`${yearPath()}/timetables`, {});
  const entries = [1, 2, 3, 4, 5, 6].flatMap((weekday) =>
    [1, 2, 3, 4, 5, 6, 7, 8].map((lessonNumber) => ({
      teachingGroupId: s.c7a.classTeachingGroupId,
      subjectId: lessonNumber <= 4 ? s.math.id : s.english.id,
      teacherId: lessonNumber <= 4 ? s.emp1.id : s.emp2.id,
      weekday,
      lessonNumber,
    })),
  );
  await s.a.put(`/timetables/${tt.id}/entries`, { entries });
  await s.a.post(`/timetables/${tt.id}/publish`, { validFrom: "2026-09-01" });
  const p = await s.a.post(`${yearPath()}/lesson-generation/preview`, { includePast: true });
  await s.a.post(`${yearPath()}/lesson-generation/apply`, { includePast: true, previewHash: p.previewHash });
  // Plenty of late-entry room for the fixtures; the late-entry rule has its own test.
  await s.a.put("/score-settings", {
    hardCapPerLesson: 10,
    hardCapPerDay: 50,
    lessonMaxPoints: 10,
    allowScoreOnAbsent: false,
    lateEntryDays: 365,
  });

  const past = await t.deps.root.lessonSession.findMany({
    where: { teachingGroupId: s.c7a.classTeachingGroupId, startsAt: { lt: new Date() } },
    orderBy: [{ date: "desc" }, { lessonNumber: "asc" }],
    select: { id: true, date: true, lessonNumber: true },
  });
  // The latest day with all eight lessons over (not today, whose later lessons may not have started).
  const date = past.find((l) => schoolDateFromDb(l.date) < today)!.date;
  const ofDay = past.filter((l) => l.date.getTime() === date.getTime());
  day = {
    date: schoolDateFromDb(date),
    maths: ofDay.filter((l) => l.lessonNumber <= 4).map((l) => l.id),
    english: ofDay.filter((l) => l.lessonNumber > 4).map((l) => l.id),
  };
}, 180_000);
afterAll(() => t.close());

describe("acceptance 17, 18, 20, 21: limits, concurrency and idempotency", () => {
  it("17: two teachers at once, daily limit 50 with 40 used: one +10 passes, the other is refused", async () => {
    for (const id of [day.maths[0]!, day.maths[1]!]) expect((await score(s.teacher1, id, 10)).status).toBe(201);
    for (const id of [day.english[0]!, day.english[1]!]) expect((await score(s.teacher2, id, 10)).status).toBe(201);
    const [r1, r2] = await Promise.all([score(s.teacher1, day.maths[2]!, 10), score(s.teacher2, day.english[2]!, 10)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const refused = [r1, r2].find((r) => r.status === 409)!;
    expect(refused.body.error).toMatchObject({
      code: "SCORE_LIMIT_EXCEEDED",
      details: { window: "DAY", scopeType: "HARD_CAP", max: "50", used: "50", remaining: "0" },
    });
    const sum = await t.deps.root.scoreEntry.aggregate({
      where: { studentId: s.s7a.id, schoolDate: { equals: await lessonDate(day.maths[0]!) } },
      _sum: { points: true },
    });
    expect(Number(sum._sum.points)).toBe(50);
  });

  it("18: the same idempotency key twice → one entry", async () => {
    await s.a.put("/score-settings", { ...(await s.a.get("/score-settings")), hardCapPerDay: 70 });
    const body = { idempotencyKey: randomUUID(), lessonSessionId: day.maths[3]!, studentId: s.s7a.id, points: 3 };
    const [a, b] = await Promise.all([
      api(t, s.teacher1).raw("post", "/scores", body),
      api(t, s.teacher1).raw("post", "/scores", body),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(await t.deps.root.scoreEntry.count({ where: { idempotencyKey: body.idempotencyKey } })).toBe(1);
    // The key cannot be reused for another student.
    const other = await api(t, s.teacher1).raw("post", "/scores", { ...body, studentId: s.s7b.id });
    expect(other.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("20: no rule lifts the hard caps", async () => {
    await s.a.post("/score-limit-rules", { window: "LESSON", scopeType: "GLOBAL", maxPoints: 100 });
    const res = await score(s.teacher2, day.english[3]!, 11);
    expect(res.body.error).toMatchObject({
      code: "SCORE_LIMIT_EXCEEDED",
      details: { window: "LESSON", scopeType: "HARD_CAP" },
    });
  });

  it("21: the school date comes from the lesson, not from the time of writing", async () => {
    const res = await score(s.teacher2, day.english[3]!, 2);
    expect(res.status).toBe(201);
    expect(res.body.schoolDate).toBe(day.date);
    expect(res.body.schoolDate).not.toBe(today);
  });
});

const lessonDate = async (id: string) =>
  (await t.deps.root.lessonSession.findUniqueOrThrow({ where: { id }, select: { date: true } })).date;

describe("acceptance 19: a subject rule over the subject default", () => {
  it("maths up to 20 a day, other subjects 10", async () => {
    // Another day, untouched by the tests above.
    const lessons = await t.deps.root.lessonSession.findMany({
      where: {
        teachingGroupId: s.c7a.classTeachingGroupId,
        startsAt: { lt: new Date() },
        date: { lt: await lessonDate(day.maths[0]!) },
      },
      orderBy: [{ date: "desc" }, { lessonNumber: "asc" }],
      take: 8,
      select: { id: true, lessonNumber: true },
    });
    const maths = lessons.filter((l) => l.lessonNumber <= 4).map((l) => l.id);
    const english = lessons.filter((l) => l.lessonNumber > 4).map((l) => l.id);
    await s.a.post("/score-limit-rules", { window: "DAY", scopeType: "SUBJECT", maxPoints: 10 });
    await s.a.post("/score-limit-rules", { window: "DAY", scopeType: "SUBJECT", scopeId: s.math.id, maxPoints: 20 });
    expect((await score(s.teacher1, maths[0]!, 10)).status).toBe(201);
    expect((await score(s.teacher1, maths[1]!, 10)).status).toBe(201);
    expect((await score(s.teacher1, maths[2]!, 1)).body.error.details).toMatchObject({
      window: "DAY",
      scopeType: "SUBJECT",
      max: "20",
    });
    expect((await score(s.teacher2, english[0]!, 10)).status).toBe(201);
    expect((await score(s.teacher2, english[1]!, 1)).body.error.details).toMatchObject({
      scopeType: "SUBJECT",
      max: "10",
    });
    // Rules are unique per window and scope.
    const dup = await api(t, s.adminAuthHeaders).raw("post", "/score-limit-rules", {
      window: "DAY",
      scopeType: "SUBJECT",
      maxPoints: 5,
    });
    expect(dup.body.error.details.reason).toBe("RULE_EXISTS");
    // Switch them off again for the tests below.
    for (const r of await s.a.get("/score-limit-rules"))
      if (r.window === "DAY" && r.scopeType === "SUBJECT")
        await s.a.patch(`/score-limit-rules/${r.id}`, { maxPoints: r.maxPoints, isActive: false });
  });
});

describe("acceptance 22: reversal", () => {
  it("net is right, the original is untouched, a second reversal is refused", async () => {
    const entry = (await score(s.teacher1, day.maths[3]!, 2)).body;
    const before = await t.deps.root.scoreEntry.findUniqueOrThrow({ where: { id: entry.id } });
    const rev = await api(t, s.teacher1).raw("post", `/scores/${entry.id}/reverse`, { idempotencyKey: randomUUID() });
    expect(rev.status).toBe(201);
    expect(rev.body).toMatchObject({ kind: "REVERSAL", points: "-2", reversesEntryId: entry.id });
    expect(await t.deps.root.scoreEntry.findUniqueOrThrow({ where: { id: entry.id } })).toEqual(before);
    const again = await api(t, s.teacher1).raw("post", `/scores/${entry.id}/reverse`, { idempotencyKey: randomUUID() });
    expect(again.body.error.details.reason).toBe("ALREADY_REVERSED");
    const journal = await api(t, s.teacher1).get(`/lesson-sessions/${day.maths[3]}/journal`);
    const row = journal.students.find((x: { studentId: string }) => x.studentId === s.s7a.id);
    expect(row.entries.find((e: { id: string }) => e.id === entry.id).reversed).toBe(true);
    // Reversing someone else's entry needs scores.correct and a reason.
    const other = (await score(s.teacher1, day.maths[3]!, 1)).body;
    const byTeacher2 = await api(t, s.teacher2).raw("post", `/scores/${other.id}/reverse`, {
      idempotencyKey: randomUUID(),
    });
    expect(byTeacher2.body.error.details.reason).toBe("NOT_OWN_ENTRY");
    const noReason = await s.a.raw("post", `/scores/${other.id}/reverse`, { idempotencyKey: randomUUID() });
    expect(noReason.status).toBe(400);
    expect(
      (await s.a.raw("post", `/scores/${other.id}/reverse`, { idempotencyKey: randomUUID(), reason: "Xato o'quvchi" }))
        .status,
    ).toBe(201);
    const audit = await t.deps.root.auditLog.count({ where: { action: "score.reverse" } });
    expect(audit).toBe(2);
  });
});

describe("acceptance 23: who may score and see", () => {
  it("a teacher cannot score another group's lesson; a guardian cannot see another student", async () => {
    const lesson7b = await t.deps.root.lessonSession.findFirst({
      where: { teachingGroupId: s.c7b.classTeachingGroupId },
      select: { id: true },
    });
    // 7-B has no lessons in this timetable: use a 7-A lesson the teacher does not teach.
    expect(lesson7b).toBeNull();
    const res = await score(s.teacher1, day.english[0]!, 1);
    expect(res.status).toBe(403);
    expect(
      (await api(t, s.guardian).raw("get", `/scores?studentId=${s.s7a.id}&from=2026-09-01&to=2026-12-31`)).status,
    ).toBe(403);
    expect((await request(t.app).post("/api/v1/scores").send({})).status).toBe(401);
  });
});

describe("rules of §3", () => {
  it("absent students, cancelled and future lessons, late entry", async () => {
    const lesson = day.maths[2]!;
    await api(t, s.teacher1).put(`/lesson-sessions/${lesson}/attendance`, {
      marks: [{ studentId: s.s7a.id, status: "ABSENT_UNEXCUSED" }],
    });
    expect((await score(s.teacher1, lesson, 1)).body.error.details.reason).toBe("STUDENT_ABSENT");

    const future = await t.deps.root.lessonSession.findFirstOrThrow({
      where: { teachingGroupId: s.c7a.classTeachingGroupId, subjectId: s.math.id, startsAt: { gt: new Date() } },
      select: { id: true },
    });
    expect((await score(s.teacher1, future.id, 1)).body.error.details.reason).toBe("LESSON_IN_FUTURE");

    const settings = await s.a.get("/score-settings");
    await s.a.put("/score-settings", { ...settings, lateEntryDays: 0 });
    const old = await t.deps.root.lessonSession.findFirstOrThrow({
      where: {
        teachingGroupId: s.c7a.classTeachingGroupId,
        subjectId: s.math.id,
        date: { lt: await lessonDate(day.maths[0]!) },
      },
      orderBy: { date: "asc" },
      select: { id: true, date: true },
    });
    expect(diffSchoolDays(schoolDateFromDb(old.date), today)).toBeGreaterThan(0);
    expect((await score(s.teacher1, old.id, 1)).body.error.details.reason).toBe("LATE_ENTRY");
    // The admin has scores.late_entry.
    expect((await score(s.adminAuthHeaders, old.id, 1)).status).toBe(201);
    await s.a.put("/score-settings", settings);
  });

  it("scoring and attendance make the lesson held; the journal shows what is left", async () => {
    const held = await t.deps.root.lessonSession.findUniqueOrThrow({ where: { id: day.maths[0]! } });
    expect(held.status).toBe("HELD");
    const journal = await api(t, s.teacher1).get(`/lesson-sessions/${day.maths[0]}/journal`);
    expect(journal).toMatchObject({ maxPoints: "10", locked: null });
    const row = journal.students.find((x: { studentId: string }) => x.studentId === s.s7a.id);
    expect(row).toMatchObject({ lessonPoints: "10", remainingLesson: "0" });
    // Teacher 2 teaches English in 7-A: sees the maths journal of the group, read-only.
    expect((await api(t, s.teacher2).get(`/lesson-sessions/${day.maths[0]}/journal`)).locked).toBe("READ_ONLY");
    // Attendance only for the group's students.
    const bad = await api(t, s.teacher1).raw("put", `/lesson-sessions/${day.maths[0]}/attendance`, {
      marks: [{ studentId: s.s7b.id, status: "PRESENT" }],
    });
    expect(bad.status).toBe(400);
  });
});

describe("acceptance 24 (first part): a closed period", () => {
  it("scoring needs assessment.reopen and a reason", async () => {
    await t.deps.root.academicPeriod.update({ where: { id: yearPeriodId }, data: { status: "CLOSED" } });
    try {
      const res = await score(s.teacher1, day.maths[3]!, 1);
      expect(res.status).toBe(403);
      expect(res.body.error.details.reason).toBe("PERIOD_CLOSED");
      expect((await score(s.adminAuthHeaders, day.maths[3]!, 1)).status).toBe(400);
      const ok = await score(s.adminAuthHeaders, day.maths[3]!, 1, { reason: "Kech kiritildi" });
      expect(ok.status).toBe(201);
      expect(ok.body.reason).toBe("Kech kiritildi");
    } finally {
      await t.deps.root.academicPeriod.update({ where: { id: yearPeriodId }, data: { status: "ACTIVE" } });
    }
  });
});

describe("settings, criteria and batches", () => {
  it("criteria are managed by assessment managers; a batch returns a result per entry", async () => {
    const c = await s.a.post("/score-criteria", { name: "Faollik" });
    expect((await api(t, s.teacher1).raw("post", "/score-criteria", { name: "X" })).status).toBe(403);
    expect((await api(t, s.teacher1).get("/score-criteria")).map((x: { name: string }) => x.name)).toContain("Faollik");
    const lesson = day.maths[1]!; // already at the lesson maximum
    const results = await api(t, s.teacher1).post("/scores", {
      entries: [
        { idempotencyKey: randomUUID(), lessonSessionId: lesson, studentId: s.s7a.id, points: 1, criterionId: c.id },
        { idempotencyKey: randomUUID(), lessonSessionId: lesson, studentId: s.s7b.id, points: 1 },
      ],
    });
    expect(results.map((r: { ok: boolean }) => r.ok)).toEqual([false, false]);
    expect(results[0].error.code).toBe("SCORE_LIMIT_EXCEEDED");
    expect(results[1].error.code).toBe("VALIDATION_ERROR");
    const bad = await s.a.raw("put", "/score-settings", {
      hardCapPerLesson: 5,
      hardCapPerDay: 50,
      lessonMaxPoints: 10,
      allowScoreOnAbsent: false,
      lateEntryDays: 3,
    });
    expect(bad.status).toBe(400);
  });
});

describe("teacher dashboard day", () => {
  it("today's lessons with scored students, and recent lessons left unscored", async () => {
    const now = new Date();
    const window = { gte: new Date(`${addSchoolDays(today, -6)}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) };
    const unscored = () =>
      t.deps.root.lessonSession.findMany({
        where: {
          tenantId: t.defaultTenant.tenant.id,
          teacherId: s.emp1.id,
          substituteTeacherId: null,
          status: { not: "CANCELLED" },
          date: window,
          endsAt: { lte: now },
          scoreEntries: { none: {} },
        },
        select: { id: true },
        orderBy: { startsAt: "desc" },
      });
    const before = await api(t, s.teacher1).get("/me/lessons/day");
    expect(before.today).toBe(today);
    const gaps = await unscored();
    expect(before.unscoredRecent).toBe(gaps.length);
    expect(before.lessons).toHaveLength(
      await t.deps.root.lessonSession.count({
        where: {
          tenantId: t.defaultTenant.tenant.id,
          teacherId: s.emp1.id,
          substituteTeacherId: null,
          status: { not: "CANCELLED" },
          date: window.lte,
        },
      }),
    );

    // Scoring one of those lessons takes it off the list; a reversed score does not count as scored.
    const started = before.lessons.find((l: { started: boolean }) => l.started);
    const target = started?.id ?? gaps[0]?.id;
    if (target) {
      const res = await score(s.teacher1, target, 1);
      expect(res.status).toBe(201);
      const after = await api(t, s.teacher1).get("/me/lessons/day");
      if (started) {
        expect(after.lessons.find((l: { id: string }) => l.id === target).scoredStudents).toBe(1);
        await api(t, s.teacher1).post(`/scores/${res.body.id}/reverse`, { idempotencyKey: randomUUID() });
        const reversed = await api(t, s.teacher1).get("/me/lessons/day");
        expect(reversed.lessons.find((l: { id: string }) => l.id === target).scoredStudents).toBe(0);
      } else expect(after.unscoredRecent).toBe(gaps.length - 1);
    }
    expect((await api(t, s.guardian).raw("get", "/me/lessons/day")).status).toBe(403);
  });
});

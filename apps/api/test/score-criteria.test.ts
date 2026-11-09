// Audit phase 4 (T-77): bounds of one entry per criterion, limit rules per criterion (their default per criterion),
// reversals freeing the limit, concurrent writes under the student lock, and who may manage the rules.
import { randomUUID } from "node:crypto";
import { schoolDateFromDb, schoolToday } from "@idrok/shared/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
const today = schoolToday("Asia/Tashkent");
const yearPath = () => `/academic-years/${s.year.id}`;
/** Maths lessons 1–4 of 7-A on the latest past school day (teacher 1). */
let maths: string[];
let activity: { id: string };
let homework: { id: string };

const score = (lessonSessionId: string, points: number | string, criterionId?: string) =>
  api(t, s.teacher1).raw("post", "/scores", {
    idempotencyKey: randomUUID(),
    lessonSessionId,
    studentId: s.s7a.id,
    points,
    ...(criterionId ? { criterionId } : {}),
  });

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  await s.a.post(`${yearPath()}/periods`, {
    type: "YEAR",
    name: "Yil",
    order: 1,
    startDate: "2026-09-01",
    endDate: "2027-06-30",
  });
  await s.a.post(`${yearPath()}/bell-schedules`, {
    name: "Asosiy",
    validFrom: "2026-09-01",
    slots: [1, 2, 3, 4].map((n) => ({
      lessonNumber: n,
      startTime: `${String(7 + n).padStart(2, "0")}:00`,
      endTime: `${String(7 + n).padStart(2, "0")}:45`,
    })),
  });
  const tt = await s.a.post(`${yearPath()}/timetables`, {});
  await s.a.put(`/timetables/${tt.id}/entries`, {
    entries: [1, 2, 3, 4, 5, 6].flatMap((weekday) =>
      [1, 2, 3, 4].map((lessonNumber) => ({
        teachingGroupId: s.c7a.classTeachingGroupId,
        subjectId: s.math.id,
        teacherId: s.emp1.id,
        weekday,
        lessonNumber,
      })),
    ),
  });
  await s.a.post(`/timetables/${tt.id}/publish`, { validFrom: "2026-09-01" });
  const p = await s.a.post(`${yearPath()}/lesson-generation/preview`, { includePast: true });
  await s.a.post(`${yearPath()}/lesson-generation/apply`, { includePast: true, previewHash: p.previewHash });
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
    select: { id: true, date: true },
  });
  const date = past.find((l) => schoolDateFromDb(l.date) < today)!.date;
  maths = past.filter((l) => l.date.getTime() === date.getTime()).map((l) => l.id);
  activity = await s.a.post("/score-criteria", { name: "Faollik", minPoints: 1, maxPoints: 4 });
  homework = await s.a.post("/score-criteria", { name: "Uy vazifasi" });
}, 180_000);
afterAll(() => t.close());

describe("criterion bounds", () => {
  it("are stored and listed; min above max is refused, also against the stored bound", async () => {
    expect(activity).toMatchObject({ minPoints: "1", maxPoints: "4" });
    expect(homework).toMatchObject({ minPoints: null, maxPoints: null });
    const bad = await s.a.raw("post", "/score-criteria", { name: "X", minPoints: 5, maxPoints: 2 });
    expect(bad.status).toBe(400);
    const crossing = await s.a.raw("patch", `/score-criteria/${activity.id}`, { name: "Faollik", minPoints: 6 });
    expect(crossing.body.error.details.fields[0]).toMatchObject({ path: "minPoints", code: "min_above_max" });
    const journal = await api(t, s.teacher1).get(`/lesson-sessions/${maths[0]}/journal`);
    expect(journal.criteria.find((c: { id: string }) => c.id === activity.id)).toMatchObject({ maxPoints: "4" });
  });

  it("one entry must fit them; entries without a criterion are not affected", async () => {
    const above = await score(maths[0]!, 5, activity.id);
    expect(above.status).toBe(400);
    expect(above.body.error.details.fields[0]).toEqual({ path: "points", code: "above_criterion_max", limit: "4" });
    const below = await score(maths[0]!, "0.5", activity.id);
    expect(below.body.error.details.fields[0]).toMatchObject({ code: "below_criterion_min", limit: "1" });
    expect(await t.deps.root.scoreEntry.count({ where: { studentId: s.s7a.id } })).toBe(0);
    expect((await score(maths[0]!, 3, activity.id)).status).toBe(201);
  });
});

describe("criterion limit rules", () => {
  it("a criterion's own rule and the default for other criteria; reversal frees the limit", async () => {
    await s.a.post("/score-limit-rules", { window: "DAY", scopeType: "CRITERION", maxPoints: 6 });
    const own = await s.a.post("/score-limit-rules", {
      window: "DAY",
      scopeType: "CRITERION",
      scopeId: activity.id,
      maxPoints: 4,
    });
    expect(own).toMatchObject({ scopeType: "CRITERION", scopeId: activity.id, scopeName: "Faollik", maxPoints: "4" });

    // Activity: 3 of its 4 used today (maths[0]).
    const over = await score(maths[1]!, 2, activity.id);
    expect(over.body.error).toMatchObject({
      code: "SCORE_LIMIT_EXCEEDED",
      details: { window: "DAY", scopeType: "CRITERION", max: "4", used: "3", remaining: "1" },
    });
    expect((await score(maths[1]!, 1, activity.id)).status).toBe(201);
    // Homework falls under the default 6; activity points do not count against it.
    expect((await score(maths[0]!, 5, homework.id)).status).toBe(201);
    expect((await score(maths[1]!, 2, homework.id)).body.error.details).toMatchObject({ scopeType: "CRITERION" });
    expect((await score(maths[1]!, 1, homework.id)).status).toBe(201);
    // No criterion: only the general limits.
    expect((await score(maths[2]!, 4)).status).toBe(201);

    const first = await t.deps.root.scoreEntry.findFirstOrThrow({
      where: { studentId: s.s7a.id, criterionId: activity.id, points: 3 },
    });
    await api(t, s.teacher1).post(`/scores/${first.id}/reverse`, { idempotencyKey: randomUUID() });
    expect((await score(maths[2]!, 3, activity.id)).status).toBe(201);
  });

  it("two teachers' requests at once cannot both pass a criterion limit", async () => {
    const book = await s.a.post("/score-criteria", { name: "Daftar" });
    await s.a.post("/score-limit-rules", { window: "DAY", scopeType: "CRITERION", scopeId: book.id, maxPoints: 3 });
    const results = await Promise.all([score(maths[3]!, 2, book.id), score(maths[3]!, 2, book.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const sum = await t.deps.root.scoreEntry.aggregate({
      where: { studentId: s.s7a.id, criterionId: book.id },
      _sum: { points: true },
    });
    expect(Number(sum._sum.points)).toBe(2);
  });

  it("one active rule per criterion and window; unknown criteria and teachers are refused", async () => {
    const dup = await s.a.raw("post", "/score-limit-rules", {
      window: "DAY",
      scopeType: "CRITERION",
      scopeId: activity.id,
      maxPoints: 2,
    });
    expect(dup.body.error.details.reason).toBe("RULE_EXISTS");
    expect(
      (
        await s.a.raw("post", "/score-limit-rules", {
          window: "DAY",
          scopeType: "CRITERION",
          scopeId: randomUUID(),
          maxPoints: 2,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api(t, s.teacher1).raw("post", "/score-limit-rules", {
          window: "WEEK",
          scopeType: "CRITERION",
          maxPoints: 2,
        })
      ).status,
    ).toBe(403);
    // A week rule per criterion is a separate rule.
    expect(
      (
        await s.a.raw("post", "/score-limit-rules", {
          window: "WEEK",
          scopeType: "CRITERION",
          scopeId: activity.id,
          maxPoints: 10,
        })
      ).status,
    ).toBe(201);
  });
});

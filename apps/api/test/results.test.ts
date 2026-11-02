// M3 steps 5–6: progress, gradebook, period results, manual scores and closing a period (scoring.md §5, §7, §8):
// acceptance 16 and the second part of 24.
import { randomUUID } from "node:crypto";
import { DEFAULT_ASSESSMENT_CONFIG } from "@idrok/shared";
import { schoolDateFromDb } from "@idrok/shared/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let half: { id: string };
let q1: { id: string };
let q2: { id: string };
let q1Maths: { id: string; date: Date }[];
const yearPath = () => `/academic-years/${s.year.id}`;
const results = (periodId: string, extra = "") =>
  s.a.get(`/period-results?periodId=${periodId}&teachingGroupId=${s.c7a.classTeachingGroupId}${extra}`);
const mathsOf = (rows: { studentId: string; subjectId: string | null }[]) =>
  rows.find((r) => r.studentId === s.s7a.id && r.subjectId === s.math.id) as Record<string, unknown>;

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  half = await s.a.post(`${yearPath()}/periods`, {
    type: "HALF",
    name: "1-yarim yil",
    order: 1,
    startDate: "2026-09-01",
    endDate: "2026-12-27",
  });
  q1 = await s.a.post(`${yearPath()}/periods`, {
    type: "QUARTER",
    name: "1-chorak",
    order: 1,
    startDate: "2026-09-01",
    endDate: "2026-10-25",
    parentId: half.id,
  });
  q2 = await s.a.post(`${yearPath()}/periods`, {
    type: "QUARTER",
    name: "2-chorak",
    order: 2,
    startDate: "2026-10-26",
    endDate: "2026-12-27",
    parentId: half.id,
  });
  for (const p of [half, q1, q2]) await s.a.post(`/periods/${p.id}/activate`);
  await s.a.post(`${yearPath()}/bell-schedules`, {
    name: "Asosiy",
    validFrom: "2026-09-01",
    slots: [
      { lessonNumber: 1, startTime: "08:00", endTime: "08:45" },
      { lessonNumber: 2, startTime: "09:00", endTime: "09:45" },
    ],
  });
  const tt = await s.a.post(`${yearPath()}/timetables`, {});
  await s.a.put(`/timetables/${tt.id}/entries`, {
    entries: [
      ...[1, 3].map((weekday) => ({
        teachingGroupId: s.c7a.classTeachingGroupId,
        subjectId: s.math.id,
        teacherId: s.emp1.id,
        weekday,
        lessonNumber: 1,
      })),
      {
        teachingGroupId: s.c7b.classTeachingGroupId,
        subjectId: s.math.id,
        teacherId: s.emp2.id,
        weekday: 2,
        lessonNumber: 1,
      },
    ],
  });
  await s.a.post(`/timetables/${tt.id}/publish`, { validFrom: "2026-09-01" });
  const p = await s.a.post(`${yearPath()}/lesson-generation/preview`, { includePast: true });
  await s.a.post(`${yearPath()}/lesson-generation/apply`, { includePast: true, previewHash: p.previewHash });
  await s.a.put("/score-settings", {
    hardCapPerLesson: 10,
    hardCapPerDay: 70,
    lessonMaxPoints: 10,
    allowScoreOnAbsent: false,
    lateEntryDays: 365,
  });
  q1Maths = await t.deps.root.lessonSession.findMany({
    where: { teachingGroupId: s.c7a.classTeachingGroupId, periodId: q1.id },
    orderBy: { date: "asc" },
    select: { id: true, date: true },
  });
  // 9 + 8 + 10 on three lessons: 27/30 = 90%; every other lesson is PENDING (not counted).
  for (const [i, points] of [9, 8, 10].entries())
    await api(t, s.teacher1).post("/scores", {
      idempotencyKey: randomUUID(),
      lessonSessionId: q1Maths[i]!.id,
      studentId: s.s7a.id,
      points,
    });
}, 180_000);
afterAll(() => t.close());

describe("progress and gradebook (§4, §8)", () => {
  it("period view: subject 90%, overall shown (BOTH), a live period result 90/100 (tests empty → redistributed)", async () => {
    const date = schoolDateFromDb(q1Maths[0]!.date);
    const progress = await api(t, s.teacher1).get(`/students/${s.s7a.id}/progress?view=PERIOD&date=${date}`);
    expect(progress).toMatchObject({ periodId: q1.id, from: "2026-09-01", to: "2026-10-25" });
    expect(progress.subjects).toEqual([
      expect.objectContaining({ subjectId: s.math.id, percent: "90", displayPercent: "90", scoredSessions: 3 }),
    ]);
    expect(progress.subjects[0].pendingSessions).toBe(q1Maths.length - 3);
    expect(progress.overall).toEqual({ percent: "90", displayPercent: "90" });
    expect(mathsOf(progress.periodResults)).toMatchObject({
      status: "LIVE",
      totalPoints: "90",
      percent: "90",
      complete: true,
    });
    expect(progress.entries).toHaveLength(3);
    // A week with one scored lesson.
    const week = await api(t, s.teacher1).get(`/students/${s.s7a.id}/progress?view=WEEK&date=${date}`);
    expect(week.subjects[0]).toMatchObject({ scoredSessions: 1, percent: "90" });
  });

  it("guardians see their own child only; other roles by scope", async () => {
    const guardian = api(t, s.guardian);
    expect((await guardian.raw("get", `/students/${s.s7a.id}/progress`)).status).toBe(404);
    expect((await guardian.raw("get", `/students/${s.s7b.id}/progress?view=MONTH`)).status).toBe(200);
    // Teacher 2 teaches 7-B only.
    expect((await api(t, s.teacher2).raw("get", `/students/${s.s7a.id}/progress`)).status).toBe(404);
  });

  it("the gradebook grid: lessons × students with states and the period percent", async () => {
    const book = await api(t, s.teacher1).get(
      `/gradebook?teachingGroupId=${s.c7a.classTeachingGroupId}&subjectId=${s.math.id}&periodId=${q1.id}`,
    );
    expect(book.sessions).toHaveLength(q1Maths.length);
    expect(book).toMatchObject({ periodStatus: "ACTIVE", manualComponents: [] });
    const row = book.students.find((x: { studentId: string }) => x.studentId === s.s7a.id);
    expect(row.percent).toBe("90");
    expect(row.cells.slice(0, 4).map((c: { state: string; points: string | null }) => [c.state, c.points])).toEqual([
      ["SCORED", "9"],
      ["SCORED", "8"],
      ["SCORED", "10"],
      ["PENDING", null],
    ]);
    expect(
      (
        await api(t, s.teacher2).raw(
          "get",
          `/gradebook?teachingGroupId=${s.c7a.classTeachingGroupId}&subjectId=${s.math.id}&periodId=${q1.id}`,
        )
      ).status,
    ).toBe(403);
  });
});

describe("manual components and closing (§5.1, §7)", () => {
  it("a MANUAL component: 60% daily weight + oral 15/20 → 84", async () => {
    const config = {
      ...DEFAULT_ASSESSMENT_CONFIG,
      components: [
        { key: "daily", type: "DAILY_SCORES" as const, name: "Kundalik", maxPoints: "60", enabled: true },
        { key: "oral", type: "MANUAL" as const, name: "Og'zaki", maxPoints: "40", enabled: true },
      ],
      testsMode: "SEPARATE" as const,
    };
    const draft = await s.a.post("/assessment/policies", { name: "Og'zaki bilan", config });
    await s.a.post(`/assessment/versions/${draft.id}/publish`);
    await s.a.post(`/periods/${q1.id}/bind-policy`, { policyVersionId: draft.id, subjectId: s.math.id });
    const before = mathsOf(await results(q1.id));
    expect(before).toMatchObject({ totalPoints: "90", percent: "90", complete: true }); // oral empty → 54/60 scaled to 100
    const body = {
      periodId: q1.id,
      subjectId: s.math.id,
      studentId: s.s7a.id,
      componentKey: "oral",
      points: 12,
      maxPoints: 20,
    };
    expect((await api(t, s.teacher2).raw("put", "/manual-scores", body)).status).toBe(403);
    expect((await api(t, s.teacher1).raw("put", "/manual-scores", { ...body, componentKey: "nope" })).status).toBe(400);
    await api(t, s.teacher1).put("/manual-scores", body);
    await api(t, s.teacher1).put("/manual-scores", { ...body, points: 14 }); // a correction keeps the history
    await api(t, s.teacher1).put("/manual-scores", { ...body, points: 15 }); // and a second one (the chain grows)
    expect(await t.deps.root.manualAssessmentScore.count({ where: { studentId: s.s7a.id } })).toBe(3);
    expect(mathsOf(await results(q1.id))).toMatchObject({ totalPoints: "84", percent: "84" });
    const book = await api(t, s.teacher1).get(
      `/gradebook?teachingGroupId=${s.c7a.classTeachingGroupId}&subjectId=${s.math.id}&periodId=${q1.id}`,
    );
    expect(book.manualComponents).toEqual([{ key: "oral", name: "Og'zaki", maxPoints: "40", final: false }]);
    const manual = await api(t, s.teacher1).get(
      `/manual-scores?periodId=${q1.id}&teachingGroupId=${s.c7a.classTeachingGroupId}&subjectId=${s.math.id}`,
    );
    expect(manual.map((m: { points: string }) => m.points)).toEqual(["15"]);
  });

  it("prepare → close: FINAL results; acceptance 16: a new policy version does not change them", async () => {
    const run = await s.a.post(`/periods/${q1.id}/prepare-close`);
    expect(run.status).toBe("PREPARED");
    expect(run.report.pendingByTeacher[0]).toMatchObject({ teacherId: s.emp1.id });
    expect(run.report.students).toBe(3);
    expect((await api(t, s.teacher1).raw("post", `/periods/${q1.id}/prepare-close`)).status).toBe(403);
    const closed = await s.a.post(`/periods/${q1.id}/close`, { runId: run.id });
    expect(closed.status).toBe("CLOSED");
    const final = mathsOf(await results(q1.id));
    expect(final).toMatchObject({ status: "FINAL", totalPoints: "84", version: 1, isStale: false });

    // A new default version with another rounding and a scale: the closed results stay as they are.
    const [policy] = await s.a.get("/assessment/policies");
    const scale = (await s.a.get("/grade-scales"))[0];
    const draft = await s.a.put(`/assessment/policies/${policy.id}/draft`, {
      config: { ...DEFAULT_ASSESSMENT_CONFIG, rounding: { mode: "FLOOR", decimals: 0 }, gradeScaleId: scale.id },
    });
    await s.a.post(`/assessment/versions/${draft.id}/publish`);
    expect(mathsOf(await results(q1.id))).toEqual(final);
    expect(
      (await s.a.raw("post", `/periods/${q1.id}/bind-policy`, { policyVersionId: draft.id, reason: "x x x" })).status,
    ).toBe(409);
  });

  it("acceptance 24 (second part): a late entry with assessment.reopen keeps FINAL, marks it stale; recompute versions it", async () => {
    const before = mathsOf(await results(q1.id));
    const res = await s.a.raw("post", "/scores", {
      idempotencyKey: randomUUID(),
      lessonSessionId: q1Maths[3]!.id,
      studentId: s.s7a.id,
      points: 5,
      reason: "Kech kiritilgan baho",
    });
    expect(res.status).toBe(201);
    const after = mathsOf(await results(q1.id));
    expect({ ...after, isStale: false }).toEqual(before);
    expect(after.isStale).toBe(true);
    // The half-year's own results are not FINAL: nothing to mark there, and it reads Q1's snapshot.
    expect((await s.a.raw("post", `/periods/${q1.id}/recompute`, {})).status).toBe(400);
    expect(await s.a.post(`/periods/${q1.id}/recompute`, { reason: "Kech kiritilgan baho" })).toEqual({
      recomputed: expect.any(Number),
    });
    const v3 = mathsOf(await results(q1.id));
    // (9+8+10+5)/40 = 80% × 60 = 48, + oral 30 = 78.
    expect(v3).toMatchObject({ status: "FINAL", version: 2, totalPoints: "78", isStale: false });
    expect(
      await t.deps.root.periodResult.count({ where: { periodId: q1.id, studentId: s.s7a.id, subjectId: s.math.id } }),
    ).toBe(2);
  });

  it("the half-year averages its quarters: Q1's snapshot and the open Q2", async () => {
    const halfMaths = mathsOf(await results(half.id));
    // Q2 has no scores yet → only Q1 counts.
    expect(halfMaths).toMatchObject({ status: "LIVE", percent: "78" });
    expect(halfMaths.components).toEqual([
      expect.objectContaining({ key: q1.id, type: "PERIOD", percent: "78" }),
      expect.objectContaining({ key: q2.id, percent: null }),
    ]);
  });
});

describe("who has not scored (§9)", () => {
  it("counts finished lessons without scores or attendance by teacher", async () => {
    const rows = await s.a.get("/reports/missing-scores?from=2026-09-01&to=2026-10-25");
    const t1 = rows.find((r: { teacherId: string }) => r.teacherId === s.emp1.id);
    expect(t1).toMatchObject({ lessons: q1Maths.length, unscored: q1Maths.length - 4 });
    expect((await api(t, s.teacher1).raw("get", "/reports/missing-scores?from=2026-09-01&to=2026-10-25")).status).toBe(
      200,
    );
    expect((await api(t, s.guardian).raw("get", "/reports/missing-scores?from=2026-09-01&to=2026-10-25")).status).toBe(
      403,
    );
  });
});

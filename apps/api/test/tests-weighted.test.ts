// M4 step 5: offline results (tests.md §6) and weighted tests in the period result (§7, scoring.md §5.2) —
// acceptance 12 (offline checks; ABSENT by the policy) and 13 (LAST / BEST retakes).
import { DEFAULT_ASSESSMENT_CONFIG } from "@idrok/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool, studentAuth } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let q1: { id: string };
let regular: string;
let question: { id: string };
let s7a2: { id: string };
let studentA: Record<string, string>;
let studentA2: Record<string, string>;
let offlineTest: { id: string };

const teacher1 = () => api(t, s.teacher1);
const as = (auth: Record<string, string>) => api(t, auth);
const minute = 60_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

const base = (extra: Record<string, unknown>) => ({
  title: "Nazorat",
  subjectId: s.math.id,
  gradeId: s.g7.id,
  testTypeId: regular,
  purpose: "WEIGHTED",
  periodId: q1.id,
  showResultToStudent: "IMMEDIATE",
  ...extra,
});

/** One online weighted test with a single 1-point question, for one student. */
async function onlineFor(studentId: string, extra: Record<string, unknown>) {
  const test = await teacher1().post(
    "/tests",
    base({ format: "ONLINE", assignTo: { studentIds: [studentId] }, ...extra }),
  );
  await teacher1().put(`/tests/${test.id}/questions`, { questions: [{ questionId: question.id }] });
  return teacher1().post(`/tests/${test.id}/publish`);
}

/** Starts, answers right or wrong, submits. */
async function take(auth: Record<string, string>, testId: string, right: boolean) {
  const v = await as(auth).post(`/tests/${testId}/start`);
  const q = v.questions[0];
  const option = q.options.find((o: { text: string }) => (o.text === "4") === right);
  await as(auth).put(`/attempts/${v.id}/answers/${q.testQuestionId}`, {
    answer: { optionIds: [option.id] },
    clientSeq: 1,
  });
  return as(auth).post(`/attempts/${v.id}/submit`);
}

async function retake(testId: string, studentId: string) {
  await s.a.post(`/tests/${testId}/overrides`, {
    studentIds: [studentId],
    startsAt: at(-minute),
    endsAt: at(60 * minute),
    reason: "Qayta topshirish",
  });
}

const testsPercentOf = async (studentId: string) => {
  const rows = await s.a.get(`/period-results?periodId=${q1.id}&teachingGroupId=${s.c7a.classTeachingGroupId}`);
  const row = rows.find(
    (r: { studentId: string; subjectId: string }) => r.studentId === studentId && r.subjectId === s.math.id,
  );
  return (
    row && {
      tests: row.components.find((c: { type: string }) => c.type === "TESTS").percent as string | null,
      percent: row.percent as string | null,
    }
  );
};

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  q1 = await s.a.post(`/academic-years/${s.year.id}/periods`, {
    type: "QUARTER",
    name: "2-chorak",
    order: 1,
    startDate: "2026-09-01",
    endDate: "2026-12-31",
  });
  await s.a.post(`/periods/${q1.id}/activate`);
  regular = (await teacher1().get("/test-types")).find((x: { code: string }) => x.code === "REGULAR").id;
  question = await teacher1().post("/question-bank/questions", {
    type: "SINGLE",
    text: "2+2?",
    subjectId: s.math.id,
    gradeId: s.g7.id,
    options: [
      { id: "a", text: "4", isCorrect: true },
      { id: "b", text: "5", isCorrect: false },
    ],
  });
  s7a2 = await s.a.post("/students", {
    firstName: "Demo",
    lastName: "Oquvchi A2",
    enrollment: { classGroupId: s.c7a.id, validFrom: "2026-09-01" },
  });
  studentA = await studentAuth(t, s, s.s7a.id, t.defaultTenant.tenant.slug);
  studentA2 = await studentAuth(t, s, s7a2.id, t.defaultTenant.tenant.slug);
}, 240_000);
afterAll(() => t.close());

describe("offline results (§6)", () => {
  it("acceptance 12: above the scale → 400; empty cells are not saved; corrections keep history", async () => {
    offlineTest = await teacher1().post(
      "/tests",
      base({
        format: "OFFLINE",
        maxScore: "20",
        schoolDate: "2026-11-02",
        assignTo: { teachingGroupIds: [s.c7a.classTeachingGroupId] },
      }),
    );
    expect(
      (
        await teacher1().raw("put", `/tests/${offlineTest.id}/offline-results`, {
          results: [{ studentId: s.s7a.id, status: "SCORED", rawScore: 17 }],
        })
      ).status,
    ).toBe(409); // DRAFT
    await teacher1().post(`/tests/${offlineTest.id}/publish`);
    const above = await teacher1().raw("put", `/tests/${offlineTest.id}/offline-results`, {
      results: [{ studentId: s.s7a.id, status: "SCORED", rawScore: 21 }],
    });
    expect(above.status).toBe(400);
    expect(above.body.error.details.fields[0]).toEqual({ path: "results.0.rawScore", code: "above_max" });
    expect(
      (
        await teacher1().raw("put", `/tests/${offlineTest.id}/offline-results`, {
          results: [{ studentId: s.s7b.id, status: "ABSENT" }],
        })
      ).status,
    ).toBe(400); // not a student of this test
    const saved = await teacher1().put(`/tests/${offlineTest.id}/offline-results`, {
      results: [
        { studentId: s.s7a.id, status: "SCORED", rawScore: 15 },
        { studentId: s7a2.id, status: "ABSENT" },
      ],
    });
    expect(saved.missing).toBe(0);
    const fixed = await teacher1().put(`/tests/${offlineTest.id}/offline-results`, {
      results: [{ studentId: s.s7a.id, status: "SCORED", rawScore: 17 }],
    });
    expect(fixed.rows.find((r: { studentId: string }) => r.studentId === s.s7a.id)).toMatchObject({
      rawScore: "17",
      percent: "85",
      corrections: 1,
    });
    expect(await t.deps.root.offlineResult.count({ where: { testId: offlineTest.id, studentId: s.s7a.id } })).toBe(2);
    // The second teacher (7-B) does not reach this test.
    expect((await api(t, s.teacher2).raw("get", `/tests/${offlineTest.id}/offline-results`)).status).toBe(404);
  });
});

describe("weighted tests in the period result (§7)", () => {
  it("acceptance 13: BEST and LAST retakes; the weights are relative", async () => {
    const best = await onlineFor(s.s7a.id, { weight: 2, retakePolicy: "BEST" });
    await take(studentA, best.id, true); // 100
    await retake(best.id, s.s7a.id);
    await take(studentA, best.id, false); // 0 — BEST keeps 100
    // s7a: offline 85 (weight 1), online BEST 100 (weight 2) → (85 + 200) / 3 = 95; no daily scores: REDISTRIBUTE.
    expect(await testsPercentOf(s.s7a.id)).toEqual({ tests: "95", percent: "95" });

    const last = await onlineFor(s7a2.id, { weight: 1, retakePolicy: "LAST" });
    await take(studentA2, last.id, false); // 0
    await retake(last.id, s7a2.id);
    await take(studentA2, last.id, true); // 100 — LAST takes it
    // s7a2: offline ABSENT is left out (missedTest EXCLUDE by default) → only the online test: 100.
    expect(await testsPercentOf(s7a2.id)).toEqual({ tests: "100", percent: "100" });
  });

  it("ABSENT under missedTest ZERO counts as 0; an open test not yet taken never counts", async () => {
    await onlineFor(s7a2.id, { weight: 5, endsAt: at(60 * minute) }); // open, not taken: pending
    const config = { ...DEFAULT_ASSESSMENT_CONFIG, missedTest: "ZERO" as const };
    const draft = await s.a.post("/assessment/policies", { name: "Qatnashmagan = 0", config });
    await s.a.post(`/assessment/versions/${draft.id}/publish`);
    await s.a.post(`/periods/${q1.id}/bind-policy`, {
      policyVersionId: draft.id,
      subjectId: s.math.id,
      reason: "Sinov",
    });
    // (0 × 1 + 100 × 1) / 2 = 50; the open test (weight 5) is not in it.
    expect(await testsPercentOf(s7a2.id)).toEqual({ tests: "50", percent: "50" });
  });

  it("SEPARATE leaves tests out; a closed period needs assessment.reopen and marks results stale", async () => {
    const run = await s.a.post(`/periods/${q1.id}/prepare-close`);
    await s.a.post(`/periods/${q1.id}/close`, { runId: run.id });
    const body = { results: [{ studentId: s.s7a.id, status: "SCORED", rawScore: 20 }] };
    expect((await teacher1().raw("put", `/tests/${offlineTest.id}/offline-results`, body)).status).toBe(403);
    expect((await s.a.raw("put", `/tests/${offlineTest.id}/offline-results`, body)).status).toBe(400); // no reason
    await s.a.put(`/tests/${offlineTest.id}/offline-results`, { ...body, reason: "Tekshiruvdan keyin" });
    const final = await t.deps.root.periodResult.findFirstOrThrow({
      where: { periodId: q1.id, studentId: s.s7a.id, subjectId: s.math.id, isCurrent: true },
    });
    expect(final).toMatchObject({ status: "FINAL", isStale: true });
  });
});

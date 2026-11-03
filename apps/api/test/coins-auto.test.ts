// M5 step 4: automatic coins for test results (offline when saved, online when closed; once per student and test),
// the coin dashboard, the ranking and teacher activity.
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@idrok/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { awardTestCoins } from "../src/modules/coins/auto-coins";
import { createTestApp } from "./support/app";
import { api, buildSchool, studentAuth } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let regular: string;
let question: { id: string };
let s7a2: { id: string };
let studentA: Record<string, string>;
let auto: { id: string };

const teacher1 = () => api(t, s.teacher1);
const award = (testId: string) =>
  runWithTenant({ tenantId: t.defaultTenant.tenant.id }, () => awardTestCoins(t.deps.db, testId));
const balance = async (studentId: string) => (await s.a.get(`/coins/students/${studentId}/summary`)).balance as number;
const settings = (over: Record<string, unknown>) =>
  s.a.get("/coins/settings").then((cur) => s.a.put("/coins/settings", { ...cur, ...over }));
const base = (extra: Record<string, unknown>) => ({
  title: "Mashq",
  subjectId: s.math.id,
  gradeId: s.g7.id,
  testTypeId: regular,
  purpose: "PRACTICE",
  showResultToStudent: "IMMEDIATE",
  ...extra,
});

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
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
  auto = await s.a.post("/coins/criteria", {
    name: "Yuqori natija",
    type: "REWARD",
    minAmount: 1,
    maxAmount: 10,
    isAutomatic: true,
    eligibility: "ALL_TEACHERS",
  });
  await s.a.post("/coins/auto-rules", {
    source: "TEST_RESULT",
    criterionId: auto.id,
    config: { minPercent: 80, amount: 3 },
  });
  await s.a.post("/coins/auto-rules", {
    source: "TEST_RESULT",
    criterionId: auto.id,
    config: { minPercent: 100, amount: 5, purposes: ["PRACTICE"] },
  });
}, 240_000);
afterAll(() => t.close());

describe("automatic coins for test results", () => {
  it("rules need a reward criterion; teachers never see automatic criteria", async () => {
    const penalty = await s.a.post("/coins/criteria", { name: "Jarima", type: "PENALTY", minAmount: 1, maxAmount: 2 });
    expect(
      (
        await s.a.raw("post", "/coins/auto-rules", {
          source: "TEST_RESULT",
          criterionId: penalty.id,
          config: { minPercent: 50, amount: 1 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await s.a.raw("post", "/coins/auto-rules", {
          source: "TEST_RESULT",
          criterionId: auto.id,
          config: { minPercent: 101, amount: 1 },
        })
      ).status,
    ).toBe(400);
    const board = await teacher1().get("/coins/teacher/board");
    expect(board.criteria.map((c: { name: string }) => c.name)).not.toContain("Yuqori natija");
    expect((await s.a.get("/coins/auto-rules")).length).toBe(2);
  });

  it("offline results: the best qualifying rule, once per student; a correction upwards may earn later", async () => {
    const test = await teacher1().post(
      "/tests",
      base({
        format: "OFFLINE",
        maxScore: "20",
        schoolDate: "2026-11-02",
        assignTo: { teachingGroupIds: [s.c7a.classTeachingGroupId] },
      }),
    );
    await teacher1().post(`/tests/${test.id}/publish`);
    await teacher1().put(`/tests/${test.id}/offline-results`, {
      results: [
        { studentId: s.s7a.id, status: "SCORED", rawScore: 20 },
        { studentId: s7a2.id, status: "SCORED", rawScore: 15 },
      ],
    });
    const events = await t.deps.root.outboxEvent.count({
      where: { type: "coins.test_results_due", aggregateId: test.id },
    });
    expect(events).toBe(1);
    expect(await award(test.id)).toBe(1);
    expect(await balance(s.s7a.id)).toBe(5);
    expect(await balance(s7a2.id)).toBe(0);
    expect(await award(test.id)).toBe(0);
    expect(await balance(s.s7a.id)).toBe(5);
    await teacher1().put(`/tests/${test.id}/offline-results`, {
      results: [{ studentId: s7a2.id, status: "SCORED", rawScore: 17 }],
    });
    expect(await award(test.id)).toBe(1);
    expect(await balance(s7a2.id)).toBe(3);
    const history = await api(t, studentA).get(`/coins/students/${s.s7a.id}/transactions`);
    expect(history.items[0]).toMatchObject({
      type: "REWARD",
      source: "TEST_RESULT",
      amount: 5,
      criterionName: "Yuqori natija",
      teacherId: null,
    });
  });

  it("online: nothing while open; awarded when the test is closed", async () => {
    const test = await teacher1().post("/tests", base({ format: "ONLINE", assignTo: { studentIds: [s.s7a.id] } }));
    await teacher1().put(`/tests/${test.id}/questions`, { questions: [{ questionId: question.id }] });
    await teacher1().post(`/tests/${test.id}/publish`);
    const v = await api(t, studentA).post(`/tests/${test.id}/start`);
    const q = v.questions[0];
    const right = q.options.find((o: { text: string }) => o.text === "4");
    await api(t, studentA).put(`/attempts/${v.id}/answers/${q.testQuestionId}`, {
      answer: { optionIds: [right.id] },
      clientSeq: 1,
    });
    await api(t, studentA).post(`/attempts/${v.id}/submit`);
    const before = await balance(s.s7a.id);
    expect(await award(test.id)).toBe(0);
    await teacher1().post(`/tests/${test.id}/close`);
    expect(
      await t.deps.root.outboxEvent.count({ where: { type: "coins.test_results_due", aggregateId: test.id } }),
    ).toBe(1);
    expect(await award(test.id)).toBe(1);
    expect(await balance(s.s7a.id)).toBe(before + 5);
  });

  it("switched off: nothing is awarded", async () => {
    const test = await teacher1().post(
      "/tests",
      base({
        format: "OFFLINE",
        maxScore: "10",
        schoolDate: "2026-11-02",
        assignTo: { studentIds: [s.s7a.id] },
      }),
    );
    await teacher1().post(`/tests/${test.id}/publish`);
    await teacher1().put(`/tests/${test.id}/offline-results`, {
      results: [{ studentId: s.s7a.id, status: "SCORED", rawScore: 10 }],
    });
    await settings({ autoCoinsEnabled: false });
    expect(await award(test.id)).toBe(0);
    await settings({ autoCoinsEnabled: true });
    expect(await award(test.id)).toBe(1);
  });
});

describe("dashboard", () => {
  it("totals, ranking and teacher activity; staff only", async () => {
    const behaviour = await s.a.post("/coins/criteria", {
      name: "Faollik",
      type: "BOTH",
      minAmount: 1,
      maxAmount: 5,
      eligibility: "ALL_TEACHERS",
    });
    await teacher1().post("/coins/transactions", {
      studentId: s.s7a.id,
      criterionId: behaviour.id,
      type: "REWARD",
      amount: 4,
      idempotencyKey: randomUUID(),
    });
    await teacher1().post("/coins/transactions", {
      studentId: s.s7a.id,
      criterionId: behaviour.id,
      type: "PENALTY",
      amount: 1,
      idempotencyKey: randomUUID(),
    });
    const o = await s.a.get("/coins/overview");
    expect(o).toMatchObject({ awarded: 4, penalties: 1, automatic: 18, evaluations: 2, studentsInDebt: 0 });
    expect(o.totalBalance).toBe((await balance(s.s7a.id)) + (await balance(s7a2.id)));
    expect(o.series).toHaveLength(30);
    expect(o.byCriterion.find((c: { name: string }) => c.name === "Faollik")).toMatchObject({
      awarded: 4,
      penalties: 1,
      count: 2,
    });
    expect((await s.a.raw("get", "/coins/overview?from=2026-11-10&to=2026-11-01")).status).toBe(400);

    const ranking = await s.a.get(`/coins/overview/ranking?classGroupId=${s.c7a.id}`);
    expect(ranking.map((r: { studentId: string }) => r.studentId)).toEqual([s.s7a.id, s7a2.id]);

    const activity = await s.a.get("/coins/overview/teachers");
    const one = activity.teachers.find((x: { teacherId: string }) => x.teacherId === s.emp1.id);
    const two = activity.teachers.find((x: { teacherId: string }) => x.teacherId === s.emp2.id);
    expect(one).toMatchObject({
      status: "ACTIVE",
      assignedStudents: 2,
      windowEvaluations: 2,
      windowStudents: 1,
      coverage: 50,
      penaltyShare: 50,
      daysSinceLast: 0,
    });
    expect(two).toMatchObject({ status: "INACTIVE", reason: "NONE_IN_WINDOW", assignedStudents: 1 });
    await settings({ activityMinCoverage: 60 });
    expect(
      (await s.a.get("/coins/overview/teachers")).teachers.find(
        (x: { teacherId: string }) => x.teacherId === s.emp1.id,
      ),
    ).toMatchObject({ status: "LOW_ACTIVITY", reason: "LOW_COVERAGE" });

    expect((await teacher1().raw("get", "/coins/overview")).status).toBe(403);
    expect((await api(t, studentA).raw("get", "/coins/overview/ranking")).status).toBe(403);
  });
});

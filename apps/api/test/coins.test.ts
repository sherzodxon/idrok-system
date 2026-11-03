// M5 step 2: the coin ledger through the API — criteria and teacher permission, limits across teachers (also under
// concurrent requests), the debt floor, reversals and corrections, adjustments, visibility and reconciliation.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reconcileCoins } from "../src/modules/coins/ledger";
import { createTestApp } from "./support/app";
import { api, buildSchool, studentAuth } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let behaviour: { id: string };
let both: { id: string };
let mathsOnly: { id: string };

const key = () => randomUUID();
let studentA: Record<string, string> | undefined;
const studentLogin = async () => (studentA ??= await studentAuth(t, s, s.s7a.id, t.defaultTenant.tenant.slug));
const give = (who: Record<string, string>, body: Record<string, unknown>) =>
  api(t, who).raw("post", "/coins/transactions", { studentId: s.s7a.id, idempotencyKey: key(), ...body });
const balance = async (studentId = s.s7a.id) =>
  (await s.a.get(`/coins/students/${studentId}/summary`)).balance as number;
const settings = (over: Record<string, unknown>) =>
  s.a.get("/coins/settings").then((cur) => s.a.put("/coins/settings", { ...cur, ...over }));

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  // Teacher 2 also teaches English in 7-A, so two teachers evaluate the same student.
  await s.a.post("/teacher-assignments", {
    teacherId: s.emp2.id,
    teachingGroupId: s.c7a.classTeachingGroupId,
    subjectId: s.english.id,
    validFrom: "2026-09-01",
  });
  behaviour = await s.a.post("/coins/criteria", {
    name: "Faollik",
    type: "REWARD",
    minAmount: 1,
    maxAmount: 5,
    eligibility: "ALL_TEACHERS",
  });
  both = await s.a.post("/coins/criteria", { name: "Intizom", type: "BOTH", minAmount: 1, maxAmount: 20 });
  await s.a.put(`/coins/criteria/${both.id}/teachers`, { teacherIds: [s.emp1.id] });
  mathsOnly = await s.a.post("/coins/criteria", {
    name: "Masala yechish",
    type: "REWARD",
    minAmount: 1,
    maxAmount: 3,
    subjectId: s.math.id,
    eligibility: "ALL_TEACHERS",
  });
});
afterAll(() => t.close());

describe("criteria and permissions", () => {
  it("the board lists the teacher's students and the criteria they may use", async () => {
    const board1 = await api(t, s.teacher1).get("/coins/teacher/board");
    expect(board1.students.map((x: { id: string }) => x.id)).toEqual([s.s7a.id]);
    expect(board1.criteria.map((c: { name: string }) => c.name).sort()).toEqual([
      "Faollik",
      "Intizom",
      "Masala yechish",
    ]);
    const board2 = await api(t, s.teacher2).get("/coins/teacher/board");
    // Teacher 2: not selected for "Intizom"; teaches maths too (7-B), so the maths criterion is listed.
    expect(board2.criteria.map((c: { name: string }) => c.name).sort()).toEqual(["Faollik", "Masala yechish"]);
    expect(board2.groups).toHaveLength(2);
  });

  it("refuses foreign students, criteria not allowed, wrong subjects, wrong directions and amounts", async () => {
    expect((await give(s.teacher1, { studentId: s.s7b.id, criterionId: behaviour.id, amount: 1 })).status).toBe(404);
    expect(
      (await give(s.teacher2, { criterionId: both.id, type: "REWARD", amount: 1 })).body.error.details.reason,
    ).toBe("CRITERION_NOT_ALLOWED");
    // Teacher 2 teaches English (not maths) in 7-A.
    expect((await give(s.teacher2, { criterionId: mathsOnly.id, amount: 1 })).body.error.details.reason).toBe(
      "CRITERION_SUBJECT",
    );
    expect((await give(s.teacher1, { criterionId: both.id, amount: 1 })).status).toBe(400);
    expect((await give(s.teacher1, { criterionId: behaviour.id, type: "PENALTY", amount: 1 })).status).toBe(400);
    expect((await give(s.teacher1, { criterionId: behaviour.id, amount: 6 })).status).toBe(400);
    // Students and guardians cannot evaluate.
    const student = await studentLogin();
    expect((await give(student, { criterionId: behaviour.id, amount: 1 })).status).toBe(403);
  });

  it("writes the ledger and the balance; a repeated key returns the first result", async () => {
    const idempotencyKey = key();
    const first = await give(s.teacher1, { criterionId: behaviour.id, amount: 3, idempotencyKey });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ balance: 3, duplicate: false, transaction: { type: "REWARD", amount: 3 } });
    const again = await give(s.teacher1, { criterionId: behaviour.id, amount: 3, idempotencyKey });
    expect(again.body).toMatchObject({ balance: 3, duplicate: true, transaction: { id: first.body.transaction.id } });
    // The same key for another student is a reuse.
    expect(
      (await give(s.teacher2, { studentId: s.s7b.id, criterionId: behaviour.id, amount: 1, idempotencyKey })).status,
    ).toBe(409);
    expect(await balance()).toBe(3);
  });
});

describe("limits", () => {
  it("count every teacher's evaluations of the student and report every failing rule", async () => {
    const day = await s.a.post("/coins/limits", { scope: "GLOBAL", period: "DAY", type: "REWARD", maxAmount: 6 });
    const each = await s.a.post("/coins/limits", { scope: "EACH_TEACHER", period: "DAY", maxCount: 5 });
    // 3 already given today by teacher 1; teacher 2 gives 2 → 5 of 6.
    expect((await give(s.teacher2, { criterionId: behaviour.id, amount: 2 })).status).toBe(200);
    const capacity = await api(t, s.teacher1).get(
      `/coins/teacher/students/${s.s7a.id}/capacity?criterionId=${behaviour.id}`,
    );
    expect(capacity).toMatchObject({ remainingAmount: 1, remainingCount: 4, blocked: null });
    const refused = await give(s.teacher1, { criterionId: behaviour.id, amount: 2 });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("COIN_LIMIT_EXCEEDED");
    expect(refused.body.error.details.reasons).toEqual([
      expect.objectContaining({ limitId: day.id, blockedBy: "AMOUNT", usedAmount: 5, remainingAmount: 1 }),
    ]);
    expect((await give(s.teacher1, { criterionId: behaviour.id, amount: 1 })).status).toBe(200);
    // Penalties are not governed by a REWARD rule.
    expect((await give(s.teacher1, { criterionId: both.id, type: "PENALTY", amount: 1 })).status).toBe(200);
    await s.a.raw("delete", `/coins/limits/${day.id}`);
    await s.a.raw("delete", `/coins/limits/${each.id}`);
    expect(await balance()).toBe(5);
  });

  it("hold under concurrent requests from two teachers", async () => {
    // A rolling window counts the evaluations of the last hour: more than 3 already → nothing passes.
    const rule = await s.a.post("/coins/limits", {
      scope: "GLOBAL",
      period: "ROLLING",
      durationMinutes: 60,
      maxCount: 3,
    });
    const blocked = await give(s.teacher2, { criterionId: behaviour.id, amount: 1 });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details.reasons[0]).toMatchObject({ period: "ROLLING", blockedBy: "COUNT" });
    expect(blocked.body.error.details.reasons[0].availableAt).not.toBeNull();
    await s.a.raw("delete", `/coins/limits/${rule.id}`);

    // A per-criterion count limit, 6 parallel requests from two teachers → exactly 2 pass.
    const sprint = await s.a.post("/coins/criteria", {
      name: "Sprint",
      type: "REWARD",
      minAmount: 1,
      maxAmount: 1,
      eligibility: "ALL_TEACHERS",
    });
    const limit = await s.a.post("/coins/limits", {
      scope: "CRITERION",
      criterionId: sprint.id,
      period: "DAY",
      maxCount: 2,
    });
    const balanceBefore = await balance();
    const parallel = await Promise.all(
      Array.from({ length: 6 }, (_, i) => give(i % 2 ? s.teacher1 : s.teacher2, { criterionId: sprint.id, amount: 1 })),
    );
    expect(parallel.filter((r) => r.status === 200)).toHaveLength(2);
    expect(parallel.filter((r) => r.status === 422)).toHaveLength(4);
    expect(await balance()).toBe(balanceBefore + 2);
    await s.a.raw("delete", `/coins/limits/${limit.id}`);
  });
});

describe("balance floor, reversals and corrections", () => {
  it("a penalty cannot go below zero unless debt is allowed, then down to −maxDebt", async () => {
    const current = await balance();
    const tooMuch = await give(s.teacher1, { criterionId: both.id, type: "PENALTY", amount: current + 1 });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error).toMatchObject({ code: "COIN_INSUFFICIENT_BALANCE", details: { available: current } });
    expect(
      (await s.a.raw("put", "/coins/settings", { ...(await s.a.get("/coins/settings")), maxDebt: 5 })).status,
    ).toBe(400);
    await settings({ allowNegativeBalance: true, maxDebt: 5 });
    expect((await give(s.teacher1, { criterionId: both.id, type: "PENALTY", amount: current + 5 })).status).toBe(200);
    expect(await balance()).toBe(-5);
    expect((await give(s.teacher1, { criterionId: both.id, type: "PENALTY", amount: 1 })).status).toBe(422);
    // A reward pays the debt off first (the ledger sum does that by itself).
    expect((await give(s.teacher1, { criterionId: behaviour.id, amount: 5 })).body.balance).toBe(0);
    await settings({ allowNegativeBalance: false, maxDebt: null });
  });

  it("the teacher undoes their own evaluation today; others need coins.reverse and a reason", async () => {
    const given = (await give(s.teacher1, { criterionId: behaviour.id, amount: 4 })).body.transaction;
    const by2 = await api(t, s.teacher2).raw("post", `/coins/transactions/${given.id}/reverse`, {
      idempotencyKey: key(),
    });
    expect(by2.status).toBe(403);
    expect((await s.a.raw("post", `/coins/transactions/${given.id}/reverse`, { idempotencyKey: key() })).status).toBe(
      400,
    );
    const own = await api(t, s.teacher1).post(`/coins/transactions/${given.id}/reverse`, { idempotencyKey: key() });
    expect(own.transaction).toMatchObject({ type: "REVERSAL", amount: -4, reversesTransactionId: given.id });
    expect(
      (await s.a.raw("post", `/coins/transactions/${given.id}/reverse`, { reason: "x", idempotencyKey: key() })).body
        .error.details.reason,
    ).toBe("ALREADY_REVERSED");
  });

  it("a correction only lowers, counts in the limits at the new amount, and a reversal undoes the rest", async () => {
    const before = await balance();
    const given = (await give(s.teacher1, { criterionId: behaviour.id, amount: 5 })).body.transaction;
    const correct = (amount: number) =>
      s.a.raw("post", `/coins/transactions/${given.id}/correct`, { amount, reason: "Xato", idempotencyKey: key() });
    expect((await correct(6)).status).toBe(400);
    expect((await correct(-1)).status).toBe(400);
    expect((await correct(2)).body).toMatchObject({
      balance: before + 2,
      transaction: { type: "CORRECTION", amount: -3 },
    });
    expect((await correct(2)).status).toBe(400);
    const list = await s.a.get(`/coins/transactions?studentId=${s.s7a.id}&type=REWARD&pageSize=1`);
    expect(list.items[0]).toMatchObject({ id: given.id, effectiveAmount: 2, reversed: false });
    const reversal = await s.a.post(`/coins/transactions/${given.id}/reverse`, {
      reason: "Xato",
      idempotencyKey: key(),
    });
    expect(reversal).toMatchObject({ balance: before, transaction: { amount: -2 } });
    // Teachers cannot correct.
    expect(
      (
        await api(t, s.teacher1).raw("post", `/coins/transactions/${given.id}/correct`, {
          amount: 1,
          reason: "x",
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(403);
  });

  it("admin adjustments need a reason and can be switched off", async () => {
    const before = await balance(s.s7b.id);
    const adj = await s.a.post("/coins/adjustments", {
      studentId: s.s7b.id,
      amount: 10,
      reason: "Olimpiada",
      idempotencyKey: key(),
    });
    expect(adj).toMatchObject({
      balance: before + 10,
      transaction: { type: "ADMIN_ADJUSTMENT", source: "ADMIN_ADJUST" },
    });
    expect(
      (await s.a.raw("post", "/coins/adjustments", { studentId: s.s7b.id, amount: 1, idempotencyKey: key() })).status,
    ).toBe(400);
    await settings({ adminAdjustmentEnabled: false });
    const off = await s.a.raw("post", "/coins/adjustments", {
      studentId: s.s7b.id,
      amount: 1,
      reason: "x",
      idempotencyKey: key(),
    });
    expect(off.body.error.details.reason).toBe("ADJUSTMENT_DISABLED");
    await settings({ adminAdjustmentEnabled: true, teacherEvaluationEnabled: false });
    expect((await give(s.teacher1, { criterionId: behaviour.id, amount: 1 })).body.error.details.reason).toBe(
      "EVALUATION_DISABLED",
    );
    await settings({ teacherEvaluationEnabled: true });
  });
});

describe("visibility and history", () => {
  it("self, own child, own teacher and coins.view only", async () => {
    const student = await studentLogin();
    const own = await api(t, student).get(`/coins/students/${s.s7a.id}/summary`);
    expect(own.balance).toBe(await balance());
    expect(own.series).toHaveLength(30);
    expect((await api(t, student).raw("get", `/coins/students/${s.s7b.id}/summary`)).status).toBe(404);
    expect((await api(t, s.guardian).get(`/coins/students/${s.s7b.id}/transactions`)).items.length).toBeGreaterThan(0);
    expect((await api(t, s.guardian).raw("get", `/coins/students/${s.s7a.id}/transactions`)).status).toBe(404);
    expect((await api(t, s.teacher1).raw("get", `/coins/students/${s.s7a.id}/summary`)).status).toBe(200);
    expect((await api(t, s.teacher1).raw("get", `/coins/students/${s.s4a.id}/summary`)).status).toBe(404);
    expect((await api(t, s.teacher1).raw("get", "/coins/transactions")).status).toBe(403);
    const mine = await api(t, s.teacher1).get("/coins/teacher/transactions?pageSize=100");
    expect(mine.items.every((x: { teacherId: string }) => x.teacherId === s.emp1.id)).toBe(true);
  });

  it("totals: earned, penalties and every write audited", async () => {
    const summary = await s.a.get(`/coins/students/${s.s7a.id}/summary`);
    expect(summary.earned - summary.penalties - summary.spent).toBe(summary.balance);
    const audit = await t.deps.root.auditLog.count({ where: { action: { startsWith: "coins." } } });
    expect(audit).toBeGreaterThan(10);
  });

  it("the daily reconciliation finds a cached balance that drifted from the ledger", async () => {
    expect(await reconcileCoins(t.deps.root)).toEqual([]);
    await t.deps.root.coinAccount.updateMany({ where: { studentId: s.s7b.id }, data: { balance: { increment: 1 } } });
    expect((await reconcileCoins(t.deps.root)).map((m) => m.studentId)).toEqual([s.s7b.id]);
    await t.deps.root.coinAccount.updateMany({ where: { studentId: s.s7b.id }, data: { balance: { decrement: 1 } } });
  });
});

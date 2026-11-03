// Coin rules: limits on schoolDate (calendar and rolling), debt floor, corrections, order flow, teacher activity and
// automatic awards. The database side (locks, concurrent requests) is in apps/api/test/coins-*.test.ts.
import { parseSchoolDate } from "@idrok/shared/time";
import { describe, expect, it } from "vitest";
import {
  canTransition,
  checkCoinLimits,
  correctionDelta,
  effectiveAmount,
  evaluationsSince,
  fitsFloor,
  limitUsage,
  penaltyFloor,
  refundsOn,
  remainingCapacity,
  teacherActivity,
  testResultAward,
  type CoinLimit,
  type CountedEvaluation,
  type LimitTarget,
} from "./coins";

const TZ = "Asia/Tashkent";
const day = (s: string) => parseSchoolDate(s);
// 2026-11-11 (Wednesday) 10:00 in Tashkent = 05:00 UTC.
const at = (d: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, d, h - 5, m));
const NOW = at(11, 10);

const rule = (over: Partial<CoinLimit>): CoinLimit => ({
  id: "r1",
  scope: "GLOBAL",
  criterionId: null,
  teacherId: null,
  type: null,
  period: "DAY",
  durationMinutes: null,
  maxAmount: null,
  maxCount: null,
  countTypesSeparately: false,
  ...over,
});
const ev = (over: Partial<CountedEvaluation>): CountedEvaluation => ({
  teacherId: "t1",
  criterionId: "c1",
  type: "REWARD",
  schoolDate: day("2026-11-11"),
  createdAt: at(11, 9),
  magnitude: 2,
  ...over,
});
const target = (over: Partial<LimitTarget> = {}): LimitTarget => ({
  teacherId: "t1",
  criterionId: "c1",
  type: "REWARD",
  schoolDate: day("2026-11-11"),
  now: NOW,
  ...over,
});
const check = (rules: CoinLimit[], evals: CountedEvaluation[], magnitude: number, t = target()) =>
  checkCoinLimits(limitUsage(rules, evals, t, TZ), magnitude);

describe("coin limits", () => {
  it("counts all teachers together for a global daily limit, by schoolDate", () => {
    const rules = [rule({ maxAmount: 5 })];
    const evals = [ev({ magnitude: 2 }), ev({ teacherId: "t2", magnitude: 2 })];
    expect(check(rules, evals, 1)).toEqual([]);
    const [r] = check(rules, evals, 2);
    expect(r).toMatchObject({ blockedBy: "AMOUNT", usedAmount: 4, remainingAmount: 1 });
    // The counter resets at the next school day's midnight in Tashkent (19:00 UTC).
    expect(r?.availableAt).toBe("2026-11-11T19:00:00.000Z");
    // Yesterday (by schoolDate) does not count, even if created late in UTC terms.
    expect(check(rules, [ev({ schoolDate: day("2026-11-10"), magnitude: 5 })], 5)).toEqual([]);
  });

  it("week and month follow the school calendar", () => {
    const week = [rule({ period: "WEEK", maxCount: 2 })];
    const monday = ev({ schoolDate: day("2026-11-09") });
    const lastSunday = ev({ schoolDate: day("2026-11-08") });
    expect(check(week, [monday, lastSunday], 1)).toEqual([]);
    expect(check(week, [monday, monday], 1)[0]).toMatchObject({ blockedBy: "COUNT", usedCount: 2 });
    const month = [rule({ period: "MONTH", maxAmount: 3 })];
    expect(check(month, [ev({ schoolDate: day("2026-10-31"), magnitude: 3 })], 3)).toEqual([]);
    expect(check(month, [ev({ schoolDate: day("2026-11-01"), magnitude: 3 })], 1)[0]?.availableAt).toBe(
      "2026-11-30T19:00:00.000Z",
    );
  });

  it("rolling windows count by time and say when capacity frees up", () => {
    const rules = [rule({ period: "ROLLING", durationMinutes: 60, maxCount: 2 })];
    const evals = [ev({ createdAt: at(11, 9, 20) }), ev({ createdAt: at(11, 9, 40) }), ev({ createdAt: at(11, 8) })];
    const [r] = check(rules, evals, 1);
    // The 09:20 one leaves the window at 10:20.
    expect(r).toMatchObject({ blockedBy: "COUNT", usedCount: 2 });
    expect(r?.availableAt).toBe(at(11, 10, 20).toISOString());
    const amount = [rule({ period: "ROLLING", durationMinutes: 60, maxAmount: 5 })];
    const two = [ev({ createdAt: at(11, 9, 20), magnitude: 3 }), ev({ createdAt: at(11, 9, 40), magnitude: 2 })];
    expect(checkCoinLimits(limitUsage(amount, two, target(), TZ), 3)[0]?.availableAt).toBe(
      at(11, 10, 20).toISOString(),
    );
    // Larger than the whole limit: never.
    expect(checkCoinLimits(limitUsage(amount, two, target(), TZ), 6)[0]?.availableAt).toBeNull();
  });

  it("scopes pick the right counter", () => {
    const evals = [ev({ teacherId: "t2", criterionId: "c2", magnitude: 3 })];
    // t1/c1 evaluates: the t2/c2 entry counts only for global.
    expect(check([rule({ maxAmount: 3 })], evals, 1)).toHaveLength(1);
    expect(check([rule({ scope: "EACH_TEACHER", maxAmount: 3 })], evals, 1)).toEqual([]);
    expect(check([rule({ scope: "EACH_CRITERION", maxAmount: 3 })], evals, 1)).toEqual([]);
    expect(
      check([rule({ scope: "EACH_CRITERION", maxAmount: 3 })], evals, 1, target({ criterionId: "c2" })),
    ).toHaveLength(1);
    // A TEACHER rule for t2 does not govern t1 at all.
    expect(check([rule({ scope: "TEACHER", teacherId: "t2", maxAmount: 1 })], evals, 1)).toEqual([]);
    expect(
      check(
        [rule({ scope: "TEACHER_CRITERION", teacherId: "t2", criterionId: "c2", maxAmount: 3 })],
        evals,
        1,
        target({ teacherId: "t2", criterionId: "c2" }),
      ),
    ).toHaveLength(1);
  });

  it("types: typed, shared and separate budgets", () => {
    const penalty = ev({ type: "PENALTY", magnitude: 3 });
    expect(check([rule({ type: "REWARD", maxAmount: 3 })], [penalty], 3)).toEqual([]);
    // A PENALTY rule does not govern a reward.
    expect(check([rule({ type: "PENALTY", maxAmount: 1 })], [], 3)).toEqual([]);
    expect(check([rule({ maxAmount: 3 })], [penalty], 1)[0]?.typeMode).toBe("BOTH_SHARED");
    expect(check([rule({ maxAmount: 3, countTypesSeparately: true })], [penalty], 3)).toEqual([]);
  });

  it("reports every failing rule", () => {
    const rules = [rule({ id: "a", maxAmount: 2 }), rule({ id: "b", maxCount: 1 }), rule({ id: "c", maxAmount: 99 })];
    expect(check(rules, [ev({ magnitude: 2 })], 1).map((r) => r.limitId)).toEqual(["a", "b"]);
  });

  it("remaining capacity is the minimum per dimension; blocked = the longest", () => {
    const rules = [
      rule({ id: "day", maxAmount: 10 }),
      rule({ id: "week", period: "WEEK", maxAmount: 4 }),
      rule({ id: "cnt", maxCount: 5 }),
    ];
    const usage = limitUsage(rules, [ev({ magnitude: 3 })], target(), TZ);
    expect(remainingCapacity(usage, 1)).toEqual({ remainingCount: 4, remainingAmount: 1, blocked: null });
    const full = limitUsage(rules, [ev({ magnitude: 4 })], target(), TZ);
    expect(remainingCapacity(full, 1).blocked?.limitId).toBe("week");
  });

  it("loads evaluations far enough back", () => {
    const today = day("2026-11-11");
    expect(evaluationsSince([], today)).toBe(today);
    expect(evaluationsSince([rule({ period: "WEEK" })], today)).toBe("2026-11-09");
    expect(evaluationsSince([rule({ period: "MONTH" })], today)).toBe("2026-11-01");
    expect(evaluationsSince([rule({ period: "ROLLING", durationMinutes: 2 * 1440 })], today)).toBe("2026-11-08");
  });
});

describe("balance", () => {
  it("penalty floor and debt", () => {
    expect(penaltyFloor({ allowNegativeBalance: false, maxDebt: 50 })).toBe(0);
    expect(penaltyFloor({ allowNegativeBalance: true, maxDebt: 50 })).toBe(-50);
    expect(penaltyFloor({ allowNegativeBalance: true, maxDebt: null })).toBeNull();
    expect(fitsFloor(3, -3, 0)).toBe(true);
    expect(fitsFloor(3, -4, 0)).toBe(false);
    expect(fitsFloor(3, -40, -50)).toBe(true);
    expect(fitsFloor(-50, -1, -50)).toBe(false);
    expect(fitsFloor(-50, 5, 0)).toBe(true);
    expect(fitsFloor(0, -1000, null)).toBe(true);
  });

  it("corrections only lower the magnitude and keep the sign", () => {
    expect(effectiveAmount(5, [-2])).toBe(3);
    expect(correctionDelta(5, 5, 3)).toEqual({ delta: -2 });
    expect(correctionDelta(5, 3, 1)).toEqual({ delta: -2 });
    expect(correctionDelta(-4, -4, -1)).toEqual({ delta: 3 });
    expect(correctionDelta(5, 5, 6)).toEqual({ error: "ABOVE_ORIGINAL" });
    expect(correctionDelta(5, 5, -1)).toEqual({ error: "SIGN" });
    expect(correctionDelta(5, 5, 0)).toEqual({ error: "SIGN" });
    expect(correctionDelta(5, 3, 3)).toEqual({ error: "UNCHANGED" });
  });

  it("order flow", () => {
    expect(canTransition("PENDING", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "DELIVERED")).toBe(true);
    expect(canTransition("PENDING", "DELIVERED")).toBe(false);
    expect(canTransition("DELIVERED", "CANCELLED")).toBe(false);
    expect(canTransition("REJECTED", "APPROVED")).toBe(false);
    expect(refundsOn("REJECTED")).toBe(true);
    expect(refundsOn("CANCELLED")).toBe(true);
    expect(refundsOn("DELIVERED")).toBe(false);
  });
});

describe("teacher activity", () => {
  const rules = { windowDays: 7, minCoverage: 30, staleDays: 3 };
  const base = {
    assignedStudents: 20,
    eligibleCriteria: 2,
    windowEvaluations: 10,
    windowStudents: 8,
    lastEvaluation: day("2026-11-10"),
    today: day("2026-11-11"),
  };
  it("classifies", () => {
    expect(teacherActivity(base, rules)).toMatchObject({ status: "ACTIVE", coverage: 40, daysSinceLast: 1 });
    expect(teacherActivity({ ...base, eligibleCriteria: 0 }, rules)).toMatchObject({
      status: "UNASSIGNED",
      reason: "NO_CRITERIA",
    });
    expect(teacherActivity({ ...base, assignedStudents: 0 }, rules).reason).toBe("NO_STUDENTS");
    expect(teacherActivity({ ...base, windowEvaluations: 0, windowStudents: 0 }, rules).status).toBe("INACTIVE");
    expect(teacherActivity({ ...base, windowStudents: 5 }, rules)).toMatchObject({
      status: "LOW_ACTIVITY",
      reason: "LOW_COVERAGE",
      coverage: 25,
    });
    expect(teacherActivity({ ...base, lastEvaluation: day("2026-11-07") }, rules)).toMatchObject({
      status: "LOW_ACTIVITY",
      reason: "STALE",
    });
  });
});

describe("automatic coins for test results", () => {
  const rules = [
    { id: "a", criterionId: "c", minPercent: 90, amount: 3, purposes: [] },
    { id: "b", criterionId: "c", minPercent: 100, amount: 5, purposes: ["WEIGHTED" as const] },
  ];
  it("picks the largest qualifying rule", () => {
    expect(testResultAward(rules, { percent: "89.99", purpose: "WEIGHTED", violation: false })).toBeNull();
    expect(testResultAward(rules, { percent: 95, purpose: "WEIGHTED", violation: false })?.id).toBe("a");
    expect(testResultAward(rules, { percent: 100, purpose: "WEIGHTED", violation: false })?.id).toBe("b");
    expect(testResultAward(rules, { percent: 100, purpose: "PRACTICE", violation: false })?.id).toBe("a");
  });
  it("no result or a violation earns nothing", () => {
    expect(testResultAward(rules, { percent: null, purpose: "PRACTICE", violation: false })).toBeNull();
    expect(testResultAward(rules, { percent: 100, purpose: "PRACTICE", violation: true })).toBeNull();
  });
});

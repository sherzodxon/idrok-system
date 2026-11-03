// Coin rules (MASTER_SPEC §14; the EdexTest limit engine moved onto schoolDate — edextest-audit.md §5). Pure: no
// database, no clock — "now" and "today" are passed in. Coins are whole numbers.
//
// Limits:
// - Every rule counts per student, across all teachers.
// - Scope: GLOBAL (all teachers and criteria), CRITERION (that criterion), TEACHER (that teacher), TEACHER_CRITERION
//   (that teacher with that criterion). EACH_CRITERION / EACH_TEACHER / EACH_TEACHER_CRITERION apply to everyone, with
//   a separate counter per criterion / teacher / teacher+criterion (the ones of this evaluation).
// - Period: DAY / WEEK / MONTH are school calendar periods (schoolDate); ROLLING is (now − duration, now].
// - Type: a REWARD or PENALTY rule counts only that type. An untyped rule shares one budget for both types, or keeps a
//   separate budget per type (countTypesSeparately).
// - Amounts count by magnitude; a corrected evaluation counts at its corrected amount, still as one evaluation.
// - Only teacher evaluations count: reversed ones, admin adjustments, automatic coins, purchases and refunds never do.
import {
  addSchoolDays,
  diffSchoolDays,
  monthRange,
  startOfSchoolDay,
  weekRange,
  type SchoolDate,
} from "@idrok/shared/time";
import { D, type Decimal, type DecimalInput } from "@idrok/shared/decimal";

export type CoinDirection = "REWARD" | "PENALTY";
export type CoinLimitScope =
  | "GLOBAL"
  | "CRITERION"
  | "TEACHER"
  | "TEACHER_CRITERION"
  | "EACH_CRITERION"
  | "EACH_TEACHER"
  | "EACH_TEACHER_CRITERION";
export type CoinLimitPeriod = "DAY" | "WEEK" | "MONTH" | "ROLLING";

export interface CoinLimit {
  id: string;
  scope: CoinLimitScope;
  criterionId: string | null;
  teacherId: string | null;
  /** null = both types. */
  type: CoinDirection | null;
  period: CoinLimitPeriod;
  durationMinutes: number | null;
  maxAmount: number | null;
  maxCount: number | null;
  countTypesSeparately: boolean;
}

/** A teacher evaluation that still stands, at its effective (corrected) magnitude. */
export interface CountedEvaluation {
  teacherId: string;
  criterionId: string;
  type: CoinDirection;
  schoolDate: SchoolDate;
  createdAt: Date;
  magnitude: number;
}

export interface LimitTarget {
  teacherId: string;
  criterionId: string;
  type: CoinDirection;
  /** The school day of the new evaluation (today). */
  schoolDate: SchoolDate;
  now: Date;
}

export interface LimitUsage {
  rule: CoinLimit;
  usedCount: number;
  usedAmount: number;
  /** Calendar periods: when the counter resets. ROLLING: null (see `entries`). */
  resetsAt: Date | null;
  /** ROLLING only: counted evaluations, oldest first — they tell when capacity frees up. */
  entries: { createdAt: Date; magnitude: number }[];
}

export type LimitTypeMode = CoinDirection | "BOTH_SHARED" | "BOTH_SEPARATE";

export interface LimitReason {
  limitId: string;
  scope: CoinLimitScope;
  period: CoinLimitPeriod;
  durationMinutes: number | null;
  typeMode: LimitTypeMode;
  blockedBy: "AMOUNT" | "COUNT";
  maxAmount: number | null;
  usedAmount: number;
  remainingAmount: number | null;
  maxCount: number | null;
  usedCount: number;
  remainingCount: number | null;
  /** When an evaluation of this size would fit again (null: not within the period / never at this size). */
  availableAt: string | null;
}

export const limitTypeMode = (rule: Pick<CoinLimit, "type" | "countTypesSeparately">): LimitTypeMode =>
  rule.type ?? (rule.countTypesSeparately ? "BOTH_SEPARATE" : "BOTH_SHARED");

const BY_TEACHER: readonly CoinLimitScope[] = [
  "TEACHER",
  "TEACHER_CRITERION",
  "EACH_TEACHER",
  "EACH_TEACHER_CRITERION",
];
const BY_CRITERION: readonly CoinLimitScope[] = [
  "CRITERION",
  "TEACHER_CRITERION",
  "EACH_CRITERION",
  "EACH_TEACHER_CRITERION",
];

/** Whether the rule governs this evaluation at all. */
export function ruleApplies(rule: CoinLimit, target: LimitTarget): boolean {
  if (rule.type && rule.type !== target.type) return false;
  switch (rule.scope) {
    case "CRITERION":
      return rule.criterionId === target.criterionId;
    case "TEACHER":
      return rule.teacherId === target.teacherId;
    case "TEACHER_CRITERION":
      return rule.teacherId === target.teacherId && rule.criterionId === target.criterionId;
    default:
      return true;
  }
}

/** The first school day of the period the target falls into, and the first day after it. */
function calendarSpan(period: Exclude<CoinLimitPeriod, "ROLLING">, day: SchoolDate) {
  const range = period === "DAY" ? { from: day, to: day } : period === "WEEK" ? weekRange(day) : monthRange(day);
  return { from: range.from, to: range.to, next: addSchoolDays(range.to, 1) };
}

/**
 * The earliest school day any of these rules looks at — the service loads evaluations from there. A rolling window
 * reaches back to the school day of (now − duration), one day earlier to be safe across midnight.
 */
export function evaluationsSince(rules: readonly CoinLimit[], today: SchoolDate): SchoolDate {
  let from = today;
  for (const r of rules) {
    const start =
      r.period === "ROLLING"
        ? addSchoolDays(today, -Math.ceil((r.durationMinutes ?? 0) / 1440) - 1)
        : calendarSpan(r.period, today).from;
    if (start < from) from = start;
  }
  return from;
}

/** Usage of every rule that governs the evaluation. */
export function limitUsage(
  rules: readonly CoinLimit[],
  evaluations: readonly CountedEvaluation[],
  target: LimitTarget,
  tz: string,
): LimitUsage[] {
  return rules
    .filter((r) => ruleApplies(r, target))
    .map((rule) => {
      const types: CoinDirection[] = rule.type
        ? [rule.type]
        : rule.countTypesSeparately
          ? [target.type]
          : ["REWARD", "PENALTY"];
      const rolling = rule.period === "ROLLING";
      const since = rolling ? target.now.getTime() - (rule.durationMinutes ?? 0) * 60_000 : 0;
      const span = rolling ? null : calendarSpan(rule.period as Exclude<CoinLimitPeriod, "ROLLING">, target.schoolDate);
      const counted = evaluations
        .filter(
          (e) =>
            types.includes(e.type) &&
            (!BY_TEACHER.includes(rule.scope) || e.teacherId === target.teacherId) &&
            (!BY_CRITERION.includes(rule.scope) || e.criterionId === target.criterionId) &&
            (span
              ? e.schoolDate >= span.from && e.schoolDate <= span.to
              : e.createdAt.getTime() > since && e.createdAt.getTime() <= target.now.getTime()),
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return {
        rule,
        usedCount: counted.length,
        usedAmount: counted.reduce((s, e) => s + e.magnitude, 0),
        resetsAt: span ? startOfSchoolDay(span.next, tz) : null,
        entries: rolling ? counted.map((e) => ({ createdAt: e.createdAt, magnitude: e.magnitude })) : [],
      };
    });
}

/** When the rule would accept an evaluation of `magnitude` again. */
function availableAt(u: LimitUsage, magnitude: number, blockedBy: "AMOUNT" | "COUNT"): Date | null {
  if (u.rule.period !== "ROLLING") return u.resetsAt;
  const windowMs = (u.rule.durationMinutes ?? 0) * 60_000;
  if (blockedBy === "COUNT") {
    const mustLeave = u.usedCount - (u.rule.maxCount ?? 0) + 1;
    const entry = u.entries[mustLeave - 1];
    return entry ? new Date(entry.createdAt.getTime() + windowMs) : null;
  }
  const max = u.rule.maxAmount ?? 0;
  if (magnitude > max) return null;
  let used = u.usedAmount;
  for (const entry of u.entries) {
    used -= entry.magnitude;
    if (used + magnitude <= max) return new Date(entry.createdAt.getTime() + windowMs);
  }
  return null;
}

function reason(u: LimitUsage, blockedBy: "AMOUNT" | "COUNT", magnitude: number): LimitReason {
  const { rule } = u;
  const at = availableAt(u, magnitude, blockedBy);
  return {
    limitId: rule.id,
    scope: rule.scope,
    period: rule.period,
    durationMinutes: rule.durationMinutes,
    typeMode: limitTypeMode(rule),
    blockedBy,
    maxAmount: rule.maxAmount,
    usedAmount: u.usedAmount,
    remainingAmount: rule.maxAmount === null ? null : Math.max(0, rule.maxAmount - u.usedAmount),
    maxCount: rule.maxCount,
    usedCount: u.usedCount,
    remainingCount: rule.maxCount === null ? null : Math.max(0, rule.maxCount - u.usedCount),
    availableAt: at ? at.toISOString() : null,
  };
}

/** Every rule must accept the evaluation; all failing rules are reported, not only the first. */
export function checkCoinLimits(usage: readonly LimitUsage[], magnitude: number): LimitReason[] {
  const reasons: LimitReason[] = [];
  for (const u of usage) {
    if (u.rule.maxCount !== null && u.usedCount + 1 > u.rule.maxCount) reasons.push(reason(u, "COUNT", magnitude));
    else if (u.rule.maxAmount !== null && u.usedAmount + magnitude > u.rule.maxAmount)
      reasons.push(reason(u, "AMOUNT", magnitude));
  }
  return reasons;
}

export interface Capacity {
  /** Evaluations left (null: no count limit). */
  remainingCount: number | null;
  /** Coins left in one evaluation (null: no amount limit). */
  remainingAmount: number | null;
  /** Why even the smallest evaluation cannot be given now — the reason that blocks the longest. */
  blocked: LimitReason | null;
}

/** Remaining capacity: coins and count are separate dimensions, each the minimum over the rules limiting it. */
export function remainingCapacity(usage: readonly LimitUsage[], minMagnitude: number): Capacity {
  let remainingCount: number | null = null;
  let remainingAmount: number | null = null;
  for (const { rule, usedCount, usedAmount } of usage) {
    if (rule.maxCount !== null) {
      const left = Math.max(0, rule.maxCount - usedCount);
      remainingCount = remainingCount === null ? left : Math.min(remainingCount, left);
    }
    if (rule.maxAmount !== null) {
      const left = Math.max(0, rule.maxAmount - usedAmount);
      remainingAmount = remainingAmount === null ? left : Math.min(remainingAmount, left);
    }
  }
  const blocked =
    checkCoinLimits(usage, minMagnitude).sort((a, b) =>
      (b.availableAt ?? "9999").localeCompare(a.availableAt ?? "9999"),
    )[0] ?? null;
  return { remainingCount, remainingAmount, blocked };
}

// ---------------------------------------------------------------------------------------------------------------
// Balance

export interface DebtSettings {
  allowNegativeBalance: boolean;
  /** null with debt allowed = no floor. */
  maxDebt: number | null;
}

/** The lowest balance a penalty may leave: 0, or −maxDebt with debt allowed (null: no floor). */
export function penaltyFloor(s: DebtSettings): number | null {
  if (!s.allowNegativeBalance) return 0;
  return s.maxDebt === null ? null : -s.maxDebt;
}

/**
 * Whether `delta` may be applied to `balance`. Credits always fit (a reward first pays off a debt — the ledger sum
 * does that by itself); debits must not take the balance below the floor (null: no floor).
 */
export function fitsFloor(balance: number, delta: number, floor: number | null): boolean {
  return delta >= 0 || floor === null || balance + delta >= floor;
}

/** The effective amount of an evaluation: the original plus its corrections. */
export const effectiveAmount = (amount: number, corrections: readonly number[]) =>
  corrections.reduce((s, c) => s + c, amount);

/**
 * A correction only lowers an evaluation's magnitude and keeps its sign (raising it would bypass the limits — that is
 * a manual adjustment). Returns the delta to write, or the reason it is refused.
 */
export function correctionDelta(
  original: number,
  effective: number,
  target: number,
): { delta: number } | { error: "SIGN" | "ABOVE_ORIGINAL" | "UNCHANGED" } {
  if (target === 0 || Math.sign(target) !== Math.sign(original)) return { error: "SIGN" };
  if (Math.abs(target) > Math.abs(original)) return { error: "ABOVE_ORIGINAL" };
  if (target === effective) return { error: "UNCHANGED" };
  return { delta: target - effective };
}

// ---------------------------------------------------------------------------------------------------------------
// Shop orders

export type CoinOrderStatus = "PENDING" | "APPROVED" | "REJECTED" | "DELIVERED" | "CANCELLED";

const TRANSITIONS: Record<CoinOrderStatus, readonly CoinOrderStatus[]> = {
  PENDING: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["DELIVERED", "CANCELLED"],
  REJECTED: [],
  DELIVERED: [],
  CANCELLED: [],
};

/** PENDING → APPROVED → DELIVERED; REJECTED and CANCELLED close the order and give the coins back. */
export const canTransition = (from: CoinOrderStatus, to: CoinOrderStatus) => TRANSITIONS[from].includes(to);
export const refundsOn = (to: CoinOrderStatus) => to === "REJECTED" || to === "CANCELLED";

// ---------------------------------------------------------------------------------------------------------------
// Teacher activity

export type TeacherActivityStatus = "ACTIVE" | "LOW_ACTIVITY" | "INACTIVE" | "UNASSIGNED";

export interface ActivityRule {
  windowDays: number;
  /** % of the teacher's students evaluated within the window. */
  minCoverage: number;
  /** Days since the last evaluation after which an otherwise active teacher is low. */
  staleDays: number;
}

export interface ActivityInput {
  assignedStudents: number;
  eligibleCriteria: number;
  /** Evaluations and distinct students within the window. */
  windowEvaluations: number;
  windowStudents: number;
  lastEvaluation: SchoolDate | null;
  today: SchoolDate;
}

export interface Activity {
  status: TeacherActivityStatus;
  /** NO_CRITERIA / NO_STUDENTS / NONE_IN_WINDOW / LOW_COVERAGE / STALE / OK */
  reason: "NO_CRITERIA" | "NO_STUDENTS" | "NONE_IN_WINDOW" | "LOW_COVERAGE" | "STALE" | "OK";
  /** Whole %, 0 without students. */
  coverage: number;
  daysSinceLast: number | null;
}

export function teacherActivity(input: ActivityInput, rule: ActivityRule): Activity {
  const coverage = input.assignedStudents
    ? Math.round((Math.min(input.windowStudents, input.assignedStudents) / input.assignedStudents) * 100)
    : 0;
  const daysSinceLast = input.lastEvaluation ? diffSchoolDays(input.lastEvaluation, input.today) : null;
  const base = { coverage, daysSinceLast };
  if (input.eligibleCriteria === 0) return { status: "UNASSIGNED", reason: "NO_CRITERIA", ...base };
  if (input.assignedStudents === 0) return { status: "UNASSIGNED", reason: "NO_STUDENTS", ...base };
  if (input.windowEvaluations === 0) return { status: "INACTIVE", reason: "NONE_IN_WINDOW", ...base };
  if (coverage < rule.minCoverage) return { status: "LOW_ACTIVITY", reason: "LOW_COVERAGE", ...base };
  if (daysSinceLast !== null && daysSinceLast > rule.staleDays)
    return { status: "LOW_ACTIVITY", reason: "STALE", ...base };
  return { status: "ACTIVE", reason: "OK", ...base };
}

// ---------------------------------------------------------------------------------------------------------------
// Automatic coins

export type TestPurpose = "PRACTICE" | "WEIGHTED";

export interface TestResultRule {
  id: string;
  criterionId: string;
  minPercent: number;
  amount: number;
  /** Empty = every purpose. */
  purposes: readonly TestPurpose[];
}

export interface FinalTestResult {
  /** 0–100; null = no result (missed, pending, excused). */
  percent: DecimalInput | null;
  purpose: TestPurpose;
  /** An attempt ended by the anti-cheat limit earns nothing. */
  violation: boolean;
}

/** The award for a student's final result of a test: the largest qualifying rule, or null. One award per test. */
export function testResultAward(rules: readonly TestResultRule[], result: FinalTestResult) {
  if (result.percent === null || result.violation) return null;
  const percent: Decimal = D(result.percent);
  const qualifying = rules.filter(
    (r) => percent.gte(r.minPercent) && (r.purposes.length === 0 || r.purposes.includes(result.purpose)),
  );
  if (!qualifying.length) return null;
  return qualifying.reduce((best, r) => (r.amount > best.amount ? r : best));
}

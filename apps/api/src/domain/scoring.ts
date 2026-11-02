// Scoring arithmetic (docs/spec/scoring.md §4, §5). Pure: no database, no clock. Percentages are on a 0–100 scale,
// kept at full precision; only the final values shown are rounded (`roundTo`, §5.6).
import type { AssessmentConfig, GradeBand, HigherAggregation, PolicyComponent } from "@idrok/shared";
import { D, Decimal, ratio, roundTo, sum, type DecimalInput } from "@idrok/shared/decimal";

const HUNDRED = D(100);
const percentOf = (earned: DecimalInput, max: DecimalInput) => ratio(earned, max)?.times(HUNDRED) ?? null;

// ---------------------------------------------------------------------------------------------------------------
// §4.1 Session outcome for one student

export type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT_EXCUSED" | "ABSENT_UNEXCUSED";
export type SessionState = "SCORED" | "PENDING" | "ABSENT_EXCUSED" | "ABSENT_UNEXCUSED" | "CANCELLED" | "UPCOMING";

export interface ScoreLine {
  id: string;
  kind: "NORMAL" | "REVERSAL";
  points: DecimalInput;
  reversesEntryId: string | null;
}

export interface StudentSession {
  cancelled: boolean;
  /** The session has started (`startsAt <= now`). */
  started: boolean;
  maxPoints: DecimalInput;
  attendance: AttendanceStatus | null;
  entries: ScoreLine[];
}

export interface SessionOutcome {
  state: SessionState;
  /** Counted sessions only; null = left out of the aggregate. */
  earned: Decimal | null;
  max: Decimal | null;
}

type OutcomePolicy = Pick<AssessmentConfig, "absentExcused" | "absentUnexcused" | "ungradedPresentAs">;

/**
 * T-40: a session is SCORED while at least one NORMAL entry is not reversed. A session whose every entry was reversed
 * (a mistake undone) is back to PENDING, not 0.
 */
export function sessionOutcome(s: StudentSession, policy: OutcomePolicy): SessionOutcome {
  const skip = (state: SessionState): SessionOutcome => ({ state, earned: null, max: null });
  const zero = (state: SessionState): SessionOutcome => ({ state, earned: D(0), max: D(s.maxPoints) });
  if (s.cancelled) return skip("CANCELLED");
  const reversed = new Set(s.entries.filter((e) => e.kind === "REVERSAL").map((e) => e.reversesEntryId));
  if (s.entries.some((e) => e.kind === "NORMAL" && !reversed.has(e.id)))
    return { state: "SCORED", earned: sum(s.entries.map((e) => e.points)), max: D(s.maxPoints) };
  if (!s.started) return skip("UPCOMING");
  if (s.attendance === "ABSENT_EXCUSED")
    return policy.absentExcused === "ZERO" ? zero("ABSENT_EXCUSED") : skip("ABSENT_EXCUSED");
  if (s.attendance === "ABSENT_UNEXCUSED")
    return policy.absentUnexcused === "ZERO" ? zero("ABSENT_UNEXCUSED") : skip("ABSENT_UNEXCUSED");
  return policy.ungradedPresentAs === "ZERO" ? zero("PENDING") : skip("PENDING");
}

// ---------------------------------------------------------------------------------------------------------------
// §4.2, §4.3 Percentages over any range (day, week, month, period)

export interface Tally {
  earned: Decimal;
  max: Decimal;
  /** null = nothing counted (no result, not 0%). */
  percent: Decimal | null;
}

export function tally(outcomes: readonly Pick<SessionOutcome, "earned" | "max">[]): Tally {
  const counted = outcomes.filter((o) => o.earned !== null && o.max !== null);
  const earned = sum(counted.map((o) => o.earned!));
  const max = sum(counted.map((o) => o.max!));
  return { earned, max, percent: percentOf(earned, max) };
}

/**
 * Overall percent over all subjects. `undefined` in BY_SUBJECT mode: the API must not return it at all (§4.3).
 * POOLED puts every counted session in one pot; WEIGHTED_SUBJECTS averages subject percents (null ones left out).
 */
export function overallPercent(
  policy: Pick<AssessmentConfig, "dailyView" | "overallMethod" | "subjectWeights">,
  bySubject: ReadonlyMap<string, Tally>,
): Decimal | null | undefined {
  if (policy.dailyView === "BY_SUBJECT") return undefined;
  const subjects = [...bySubject.entries()];
  if (policy.overallMethod === "POOLED")
    return percentOf(sum(subjects.map(([, t]) => t.earned)), sum(subjects.map(([, t]) => t.max)));
  return weightedAverage(subjects.map(([id, t]) => ({ value: t.percent, weight: policy.subjectWeights[id] ?? 1 })));
}

/** Σ(value × weight) / Σ weight over the values that exist; null when none does. */
export function weightedAverage(items: readonly { value: Decimal | null; weight: DecimalInput }[]): Decimal | null {
  const present = items.filter((i) => i.value !== null && !D(i.weight).isZero());
  return ratio(sum(present.map((i) => i.value!.times(i.weight))), sum(present.map((i) => i.weight)));
}

// ---------------------------------------------------------------------------------------------------------------
// §5.2 Tests component

export interface TestInput {
  weight: DecimalInput;
  /** Percent of each finished attempt in time order; empty = the student did not take the test. */
  attempts: DecimalInput[];
}

export function testsPercent(
  tests: readonly TestInput[],
  policy: Pick<AssessmentConfig, "missedTest" | "retakePolicy">,
): Decimal | null {
  const items = tests.flatMap((t) => {
    if (!t.attempts.length) return policy.missedTest === "ZERO" ? [{ value: D(0), weight: t.weight }] : [];
    const value = policy.retakePolicy === "BEST" ? Decimal.max(...t.attempts) : D(t.attempts[t.attempts.length - 1]!);
    return [{ value, weight: t.weight }];
  });
  return weightedAverage(items);
}

// ---------------------------------------------------------------------------------------------------------------
// §5.1, §5.3 Period result of one subject from its components

export interface ComponentInputs {
  /** DAILY_SCORES: the subject's percent over the period (§4.2). */
  daily: Decimal | null;
  /** TESTS: `testsPercent`. */
  tests: Decimal | null;
  /** MANUAL: by component key; null / missing = not entered. */
  manual: ReadonlyMap<string, { earned: DecimalInput; max: DecimalInput } | null>;
}

export interface ComponentResult {
  key: string;
  type: PolicyComponent["type"];
  maxPoints: Decimal;
  /** null = no input (empty component). */
  percent: Decimal | null;
  points: Decimal | null;
}

export interface PeriodComputation {
  components: ComponentResult[];
  /** False when the result cannot be given (PENDING empty component, or nothing at all to count). */
  complete: boolean;
  total: Decimal | null;
  maxPoints: Decimal;
  percent: Decimal | null;
}

function componentPercent(c: PolicyComponent, inputs: ComponentInputs): Decimal | null {
  if (c.type === "DAILY_SCORES") return inputs.daily;
  if (c.type === "TESTS") return inputs.tests;
  const m = inputs.manual.get(c.key);
  return m ? percentOf(m.earned, m.max) : null;
}

export function periodResult(
  config: Pick<AssessmentConfig, "components" | "periodMaxPoints" | "emptyComponent" | "testsMode">,
  inputs: ComponentInputs,
): PeriodComputation {
  const periodMax = D(config.periodMaxPoints);
  const components = config.components
    .filter((c) => c.enabled && !(c.type === "TESTS" && config.testsMode === "SEPARATE"))
    .map((c): ComponentResult => {
      const percent = componentPercent(c, inputs);
      const maxPoints = D(c.maxPoints);
      return { key: c.key, type: c.type, maxPoints, percent, points: percent?.div(HUNDRED).times(maxPoints) ?? null };
    });
  const empty = components.filter((c) => c.percent === null);
  const present = components.filter((c) => c.percent !== null);
  const none = { components, complete: false, total: null, maxPoints: periodMax, percent: null };
  if (!present.length || (empty.length && config.emptyComponent === "PENDING")) return none;

  let total = sum(present.map((c) => c.points!));
  if (empty.length && config.emptyComponent === "REDISTRIBUTE") {
    // Scale what exists to the full period maximum.
    total = total.times(periodMax).div(sum(present.map((c) => c.maxPoints)));
  }
  return { components, complete: true, total, maxPoints: periodMax, percent: percentOf(total, periodMax) };
}

// ---------------------------------------------------------------------------------------------------------------
// §5.4 Half-year and year from lower periods

export interface HigherRule {
  aggregation: HigherAggregation;
  weights?: Record<string, DecimalInput>;
  finalComponent?: { key: string; weight: DecimalInput };
}

/** INDEPENDENT periods are computed with `periodResult` on their own inputs, not here. */
export function higherPeriodPercent(
  rule: HigherRule,
  children: readonly { periodId: string; percent: Decimal | null }[],
  finalPercent: Decimal | null = null,
): Decimal | null {
  if (rule.aggregation === "INDEPENDENT") throw new Error("INDEPENDENT periods use their own components");
  if (rule.aggregation === "AVERAGE") return weightedAverage(children.map((c) => ({ value: c.percent, weight: 1 })));
  const items = children.map((c) => ({ value: c.percent, weight: rule.weights?.[c.periodId] ?? 0 }));
  if (rule.aggregation === "WEIGHTED_WITH_FINAL" && rule.finalComponent)
    items.push({ value: finalPercent, weight: rule.finalComponent.weight });
  return weightedAverage(items);
}

// ---------------------------------------------------------------------------------------------------------------
// §5.6 Rounding and the 5-point grade

export { roundTo };

/** `min ≤ p < max`; the last band includes its max (100). */
export function gradeLabel(bands: readonly GradeBand[], percent: DecimalInput): string | null {
  const p = D(percent);
  const sorted = [...bands].sort((a, b) => D(a.minPercent).comparedTo(b.minPercent));
  for (const [i, b] of sorted.entries()) {
    const last = i === sorted.length - 1;
    if (p.gte(b.minPercent) && (p.lt(b.maxPercent) || (last && p.lte(b.maxPercent)))) return b.label;
  }
  return null;
}

export type PolicyProblem =
  | "NO_COMPONENTS"
  | "COMPONENTS_SUM_MISMATCH"
  | "DUPLICATE_COMPONENT_KEY"
  | "TESTS_COMPONENT_IN_SEPARATE_MODE"
  | "HIGHER_WEIGHTS_MISSING"
  | "FINAL_COMPONENT_MISSING";

/** Checks run when a policy version is published (§5.1, §5.2). */
export function policyProblems(config: AssessmentConfig): PolicyProblem[] {
  const problems: PolicyProblem[] = [];
  const enabled = config.components.filter((c) => c.enabled);
  if (!enabled.length) problems.push("NO_COMPONENTS");
  if (!sum(enabled.map((c) => c.maxPoints)).equals(config.periodMaxPoints)) problems.push("COMPONENTS_SUM_MISMATCH");
  if (new Set(config.components.map((c) => c.key)).size !== config.components.length)
    problems.push("DUPLICATE_COMPONENT_KEY");
  if (config.testsMode === "SEPARATE" && enabled.some((c) => c.type === "TESTS"))
    problems.push("TESTS_COMPONENT_IN_SEPARATE_MODE");
  for (const rule of [...config.higherPeriods, config.higherDefault]) {
    const needsWeights = rule.aggregation === "WEIGHTED" || rule.aggregation === "WEIGHTED_WITH_FINAL";
    // The default rule cannot name periods, so it cannot be weighted.
    if (needsWeights && (!("periodId" in rule) || !Object.keys(rule.weights ?? {}).length))
      problems.push("HIGHER_WEIGHTS_MISSING");
    if (rule.aggregation === "WEIGHTED_WITH_FINAL" && !rule.finalComponent) problems.push("FINAL_COMPONENT_MISSING");
  }
  return [...new Set(problems)];
}

export type GradeScaleProblem = "NO_BANDS" | "BAND_EMPTY" | "GAP_OR_OVERLAP" | "NOT_FROM_0_TO_100" | "DUPLICATE_LABEL";

/** Bands must cover 0–100 with no gap and no overlap (§5.6). */
export function gradeScaleProblems(bands: readonly GradeBand[]): GradeScaleProblem[] {
  if (!bands.length) return ["NO_BANDS"];
  const problems = new Set<GradeScaleProblem>();
  const sorted = [...bands].sort((a, b) => D(a.minPercent).comparedTo(b.minPercent));
  if (!D(sorted[0]!.minPercent).isZero() || !D(sorted[sorted.length - 1]!.maxPercent).equals(100))
    problems.add("NOT_FROM_0_TO_100");
  for (const [i, b] of sorted.entries()) {
    if (D(b.minPercent).gte(b.maxPercent)) problems.add("BAND_EMPTY");
    const next = sorted[i + 1];
    if (next && !D(next.minPercent).equals(b.maxPercent)) problems.add("GAP_OR_OVERLAP");
  }
  if (new Set(bands.map((b) => b.label)).size !== bands.length) problems.add("DUPLICATE_LABEL");
  return [...problems];
}

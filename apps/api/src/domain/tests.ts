// Test arithmetic and rules (docs/spec/tests.md §3–§8, security-baseline.md S4–S5). Pure: no database, no clock —
// "now" is always passed in. Points and percentages are Decimal (0–100 scale for percentages).
import { createHash } from "node:crypto";
import { normalizeText } from "@idrok/shared";
import { D, Decimal, ratio, sum, type DecimalInput } from "@idrok/shared/decimal";

export { normalizeText };

export type QuestionType = "SINGLE" | "MULTIPLE" | "SHORT_TEXT" | "MATCHING";
export type MultipleScoring = "ALL_OR_NOTHING" | "PARTIAL";

export interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
}
export interface MatchingPair {
  leftId: string;
  left: string;
  rightId: string;
  right: string;
}

/** A question version as the grader sees it (with the key). */
export interface GradableQuestion {
  type: QuestionType;
  options: readonly QuestionOption[];
  acceptedAnswers?: readonly string[] | null;
  pairs?: readonly MatchingPair[] | null;
}

/** What a student sends: option ids, a text, or left→right pairs (ids only, never texts). */
export type AnswerValue = { optionIds: string[] } | { text: string } | { pairs: { leftId: string; rightId: string }[] };

// ---------------------------------------------------------------------------------------------------------------
// §4.6 Grading

export interface Graded {
  /** Full points only; a partial MULTIPLE answer is not "correct". */
  isCorrect: boolean;
  points: Decimal;
}

export function gradeAnswer(
  q: GradableQuestion,
  answer: AnswerValue | null,
  points: DecimalInput,
  multipleScoring: MultipleScoring = "ALL_OR_NOTHING",
): Graded {
  const full = D(points);
  const zero = { isCorrect: false, points: D(0) };
  if (!answer) return zero;
  if (q.type === "SINGLE" || q.type === "MULTIPLE") {
    if (!("optionIds" in answer)) return zero;
    const chosen = new Set(answer.optionIds);
    const correct = q.options.filter((o) => o.isCorrect).map((o) => o.id);
    const right = correct.filter((id) => chosen.has(id)).length;
    const wrong = chosen.size - right;
    const exact = right === correct.length && wrong === 0;
    if (exact) return { isCorrect: true, points: full };
    if (q.type === "MULTIPLE" && multipleScoring === "PARTIAL" && correct.length > 0) {
      const share = Decimal.max(0, D(right - wrong).dividedBy(correct.length));
      return { isCorrect: false, points: full.times(share) };
    }
    return zero;
  }
  if (q.type === "SHORT_TEXT") {
    if (!("text" in answer)) return zero;
    const given = normalizeText(answer.text);
    const ok = given !== "" && (q.acceptedAnswers ?? []).some((a) => normalizeText(a) === given);
    return ok ? { isCorrect: true, points: full } : zero;
  }
  if (!("pairs" in answer)) return zero;
  const key = q.pairs ?? [];
  if (!key.length) return zero;
  const expected = new Map(key.map((p) => [p.leftId, p.rightId]));
  const seen = new Set<string>();
  let right = 0;
  for (const p of answer.pairs) {
    if (seen.has(p.leftId)) continue;
    seen.add(p.leftId);
    if (expected.get(p.leftId) === p.rightId) right++;
  }
  return { isCorrect: right === key.length, points: full.times(right).dividedBy(key.length) };
}

export interface AttemptScore {
  score: Decimal;
  maxScore: Decimal;
  percent: Decimal | null;
}

export function attemptScore(items: readonly { points: DecimalInput; awarded: DecimalInput }[]): AttemptScore {
  const score = sum(items.map((i) => i.awarded));
  const maxScore = sum(items.map((i) => i.points));
  return { score, maxScore, percent: ratio(score, maxScore)?.times(100) ?? null };
}

// ---------------------------------------------------------------------------------------------------------------
// S5 Answer shape check: everything refers to this question version; a mismatch is a 400, never accepted silently.

export type AnswerProblem = "WRONG_KIND" | "UNKNOWN_OPTION" | "SINGLE_EXPECTS_ONE" | "DUPLICATE" | "TOO_LONG";

export function answerProblem(q: GradableQuestion, answer: AnswerValue): AnswerProblem | null {
  if (q.type === "SINGLE" || q.type === "MULTIPLE") {
    if (!("optionIds" in answer)) return "WRONG_KIND";
    const ids = new Set(q.options.map((o) => o.id));
    if (answer.optionIds.some((id) => !ids.has(id))) return "UNKNOWN_OPTION";
    if (new Set(answer.optionIds).size !== answer.optionIds.length) return "DUPLICATE";
    if (q.type === "SINGLE" && answer.optionIds.length > 1) return "SINGLE_EXPECTS_ONE";
    return null;
  }
  if (q.type === "SHORT_TEXT") {
    if (!("text" in answer)) return "WRONG_KIND";
    return answer.text.length > 500 ? "TOO_LONG" : null;
  }
  if (!("pairs" in answer)) return "WRONG_KIND";
  const lefts = new Set((q.pairs ?? []).map((p) => p.leftId));
  const rights = new Set((q.pairs ?? []).map((p) => p.rightId));
  if (answer.pairs.some((p) => !lefts.has(p.leftId) || !rights.has(p.rightId))) return "UNKNOWN_OPTION";
  if (new Set(answer.pairs.map((p) => p.leftId)).size !== answer.pairs.length) return "DUPLICATE";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// §4.1 A well-formed question (checked on save and again when a test is published)

export type QuestionProblem =
  | "TOO_FEW_OPTIONS"
  | "SINGLE_NEEDS_ONE_CORRECT"
  | "MULTIPLE_NEEDS_CORRECT"
  | "NO_ACCEPTED_ANSWERS"
  | "TOO_FEW_PAIRS"
  | "EMPTY_TEXT"
  | "DUPLICATE_IDS";

export function questionProblems(q: GradableQuestion & { text: string }): QuestionProblem[] {
  const problems: QuestionProblem[] = [];
  if (!q.text.trim()) problems.push("EMPTY_TEXT");
  if (q.type === "SINGLE" || q.type === "MULTIPLE") {
    if (q.options.length < 2) problems.push("TOO_FEW_OPTIONS");
    if (q.options.some((o) => !o.text.trim())) problems.push("EMPTY_TEXT");
    const correct = q.options.filter((o) => o.isCorrect).length;
    if (q.type === "SINGLE" && correct !== 1) problems.push("SINGLE_NEEDS_ONE_CORRECT");
    if (q.type === "MULTIPLE" && correct < 1) problems.push("MULTIPLE_NEEDS_CORRECT");
    if (new Set(q.options.map((o) => o.id)).size !== q.options.length) problems.push("DUPLICATE_IDS");
  }
  if (q.type === "SHORT_TEXT" && !(q.acceptedAnswers ?? []).some((a) => normalizeText(a))) {
    problems.push("NO_ACCEPTED_ANSWERS");
  }
  if (q.type === "MATCHING") {
    const pairs = q.pairs ?? [];
    if (pairs.length < 2) problems.push("TOO_FEW_PAIRS");
    if (pairs.some((p) => !p.left.trim() || !p.right.trim())) problems.push("EMPTY_TEXT");
    const ids = pairs.flatMap((p) => [p.leftId, p.rightId]);
    if (new Set(ids).size !== ids.length) problems.push("DUPLICATE_IDS");
  }
  return [...new Set(problems)];
}

/** §3 Duplicate check: normalised text and options (order-insensitive), so a re-import is recognised. */
export function contentHash(q: {
  type: QuestionType;
  text: string;
  options?: readonly { text: string }[];
  acceptedAnswers?: readonly string[] | null;
  pairs?: readonly { left: string; right: string }[] | null;
}): string {
  const parts = [
    q.type,
    normalizeText(q.text),
    ...(q.options ?? []).map((o) => normalizeText(o.text)).sort(),
    ...(q.acceptedAnswers ?? []).map(normalizeText).sort(),
    ...(q.pairs ?? []).map((p) => `${normalizeText(p.left)}=${normalizeText(p.right)}`).sort(),
  ];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

// ---------------------------------------------------------------------------------------------------------------
// §4.2 Order: deterministic from a seed (the attempt id), stored on the attempt and never recomputed.

function seedFrom(text: string): () => number {
  // xmur3 string hash → mulberry32 generator; integers only, no floating state kept between runs.
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Fisher–Yates with a seeded generator (uniform, unlike `sort(() => Math.random() - 0.5)`). */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const next = seedFrom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface PoolRule {
  topicId: string | null;
  difficulty: "EASY" | "MEDIUM" | "HARD" | null;
  count: number;
}
export interface PoolCandidate {
  id: string;
  topicId: string | null;
  difficulty: "EASY" | "MEDIUM" | "HARD";
}

/**
 * Pool selection: each rule takes `count` questions matching it, never one twice. Returns null when a rule cannot be
 * filled (the test cannot be published with that pool).
 */
export function selectFromPool(rules: readonly PoolRule[], candidates: readonly PoolCandidate[], seed: string) {
  const taken = new Set<string>();
  const out: string[] = [];
  for (const [i, rule] of rules.entries()) {
    const matching = candidates.filter(
      (c) =>
        !taken.has(c.id) &&
        (rule.topicId === null || c.topicId === rule.topicId) &&
        (rule.difficulty === null || c.difficulty === rule.difficulty),
    );
    if (matching.length < rule.count) return null;
    for (const c of seededShuffle(matching, `${seed}:${i}`).slice(0, rule.count)) {
      taken.add(c.id);
      out.push(c.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// §4.2, §5 Window and deadline

export interface Window {
  startsAt: Date | null;
  endsAt: Date | null;
  timeLimitMinutes: number | null;
}

export type WindowState = "NOT_YET" | "OPEN" | "OVER";

export function windowState(w: Pick<Window, "startsAt" | "endsAt">, now: Date): WindowState {
  if (w.startsAt && now < w.startsAt) return "NOT_YET";
  if (w.endsAt && now >= w.endsAt) return "OVER";
  return "OPEN";
}

/** `deadline = min(startedAt + timeLimit, windowEnd)`; null when neither limits the attempt. */
export function attemptDeadline(startedAt: Date, w: Pick<Window, "endsAt" | "timeLimitMinutes">): Date | null {
  const byLimit = w.timeLimitMinutes ? new Date(startedAt.getTime() + w.timeLimitMinutes * 60_000) : null;
  if (byLimit && w.endsAt) return byLimit < w.endsAt ? byLimit : w.endsAt;
  return byLimit ?? w.endsAt;
}

export const isPastDeadline = (deadline: Date | null, now: Date) => deadline !== null && now >= deadline;

// ---------------------------------------------------------------------------------------------------------------
// §4.4 Anti-cheat: only the server counts violations.

export type TestEventType = "VISIBILITY_HIDDEN" | "VISIBILITY_VISIBLE" | "BLUR" | "FOCUS" | "RECONNECT";
const VIOLATIONS: ReadonlySet<TestEventType> = new Set(["VISIBILITY_HIDDEN", "BLUR"]);
export const DEDUPE_MS = 2_000;

export interface SeenEvent {
  type: TestEventType;
  serverTs: Date;
  counted: boolean;
}

/**
 * Whether a new event counts as a violation. The same type again within 2 s does not count; a blur does not count
 * next to a counted hidden page (switching tabs fires both), nor a hidden page next to a counted blur.
 */
export function countsAsViolation(previous: readonly SeenEvent[], event: Omit<SeenEvent, "counted">): boolean {
  if (!VIOLATIONS.has(event.type)) return false;
  const t = event.serverTs.getTime();
  const near = (e: SeenEvent) => Math.abs(t - e.serverTs.getTime()) < DEDUPE_MS;
  if (previous.some((e) => e.type === event.type && near(e))) return false;
  return !previous.some((e) => e.counted && VIOLATIONS.has(e.type) && near(e));
}

/** threshold 0 = off; otherwise the attempt ends on the threshold-th counted violation (Q-20). */
export const violationLimitReached = (count: number, threshold: number) => threshold > 0 && count >= threshold;

// ---------------------------------------------------------------------------------------------------------------
// S4 What a student may see of a finished attempt

export type ShowResult = "IMMEDIATE" | "AFTER_CLOSE" | "NEVER";

export interface VisibilityInput {
  showResultToStudent: ShowResult;
  testClosed: boolean;
  endsAt: Date | null;
  /** End of every retake / individual window of this test. */
  overrideEnds: readonly Date[];
  now: Date;
}

/** The window is over: the common end (or CLOSED when there is none) and every retake window. */
export function testWindowClosed(v: Omit<VisibilityInput, "showResultToStudent">): boolean {
  const commonOver = v.testClosed || (v.endsAt !== null && v.now >= v.endsAt);
  return commonOver && v.overrideEnds.every((end) => v.now >= end);
}

export function resultVisibility(v: VisibilityInput): { score: boolean; perQuestion: boolean } {
  if (v.showResultToStudent === "NEVER") return { score: false, perQuestion: false };
  const closed = testWindowClosed(v);
  return { score: v.showResultToStudent === "IMMEDIATE" || closed, perQuestion: closed };
}

// ---------------------------------------------------------------------------------------------------------------
// §6 Offline results

export const OFFLINE_SCALES = [5, 10, 20, 25, 40, 50, 100] as const;

export function offlinePercent(rawScore: DecimalInput, maxScore: DecimalInput): Decimal | null {
  return ratio(rawScore, maxScore)?.times(100) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// §8 Statistics

export interface Summary {
  count: number;
  mean: Decimal | null;
  median: Decimal | null;
  min: Decimal | null;
  max: Decimal | null;
  /** Ten buckets of 10 percent points; 100 falls into the last one. */
  histogram: number[];
}

export function summarize(percents: readonly DecimalInput[]): Summary {
  const values = percents.map(D).sort((a, b) => a.comparedTo(b));
  const histogram = Array.from({ length: 10 }, () => 0);
  for (const v of values) histogram[Math.min(9, Math.max(0, v.dividedToIntegerBy(10).toNumber()))]!++;
  if (!values.length) return { count: 0, mean: null, median: null, min: null, max: null, histogram };
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid]! : values[mid - 1]!.plus(values[mid]!).dividedBy(2);
  return {
    count: values.length,
    mean: sum(values).dividedBy(values.length),
    median,
    min: values[0]!,
    max: values[values.length - 1]!,
    histogram,
  };
}

/** Topic mastery: points earned over points possible across the questions of each topic. */
export function topicMastery(
  answers: readonly { topicId: string | null; points: DecimalInput; awarded: DecimalInput }[],
): Map<string | null, { earned: Decimal; max: Decimal; percent: Decimal | null }> {
  const out = new Map<string | null, { earned: Decimal; max: Decimal; percent: Decimal | null }>();
  for (const a of answers) {
    const cur = out.get(a.topicId) ?? { earned: D(0), max: D(0), percent: null };
    cur.earned = cur.earned.plus(a.awarded);
    cur.max = cur.max.plus(a.points);
    out.set(a.topicId, cur);
  }
  for (const v of out.values()) v.percent = ratio(v.earned, v.max)?.times(100) ?? null;
  return out;
}

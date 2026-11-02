// Score limits (docs/spec/scoring.md §3.1). Pure: the service loads the student's entries around the date (under the
// student lock) and asks whether a new entry fits.
import { D, Decimal, sum, type DecimalInput } from "@idrok/shared/decimal";
import { monthRange, weekRange, type SchoolDate } from "@idrok/shared/time";

export const LIMIT_WINDOWS = ["LESSON", "DAY", "WEEK", "MONTH", "PERIOD"] as const;
export type LimitWindow = (typeof LIMIT_WINDOWS)[number];
export const LIMIT_SCOPES = ["GLOBAL", "SUBJECT", "GRADE", "TEACHER", "TEACHING_GROUP"] as const;
export type LimitScope = (typeof LIMIT_SCOPES)[number];

export interface LimitRule {
  window: LimitWindow;
  scopeType: LimitScope;
  /** null = the default for every subject / grade / teacher / group of this type. */
  scopeId: string | null;
  maxPoints: DecimalInput;
}

/** Where an entry belongs; the same shape for the new entry and the existing ones. */
export interface EntryScope {
  lessonSessionId: string;
  schoolDate: SchoolDate;
  periodId: string;
  subjectId: string;
  teacherId: string;
  gradeId: string;
  teachingGroupId: string;
}

export interface ExistingEntry extends EntryScope {
  /** NORMAL > 0, REVERSAL < 0: the sum is the net. */
  points: DecimalInput;
}

export interface LimitSettings {
  hardCapPerLesson: DecimalInput;
  hardCapPerDay: DecimalInput;
  lessonMaxPoints: DecimalInput;
}

export interface LimitViolation {
  window: LimitWindow;
  /** HARD_CAP for the school-wide caps no rule can raise. */
  scopeType: LimitScope | "HARD_CAP";
  max: Decimal;
  used: Decimal;
  remaining: Decimal;
}

const scopeValue = (scope: LimitScope, e: EntryScope): string | null =>
  scope === "SUBJECT"
    ? e.subjectId
    : scope === "GRADE"
      ? e.gradeId
      : scope === "TEACHER"
        ? e.teacherId
        : scope === "TEACHING_GROUP"
          ? e.teachingGroupId
          : null;

/**
 * For each window and scope type, the rule that applies: the one for this exact subject / grade / ... if there is
 * one, else the default of the type. More specific wins only among rules of the same type (§3.1 step 1).
 */
export function applicableRules(rules: readonly LimitRule[], entry: EntryScope): LimitRule[] {
  const chosen: LimitRule[] = [];
  for (const window of LIMIT_WINDOWS)
    for (const scopeType of LIMIT_SCOPES) {
      const ofType = rules.filter((r) => r.window === window && r.scopeType === scopeType);
      const value = scopeValue(scopeType, entry);
      const exact = value === null ? undefined : ofType.find((r) => r.scopeId === value);
      const rule = exact ?? ofType.find((r) => r.scopeId === null);
      if (rule) chosen.push(rule);
    }
  return chosen;
}

function inWindow(window: LimitWindow, e: EntryScope, target: EntryScope): boolean {
  switch (window) {
    case "LESSON":
      return e.lessonSessionId === target.lessonSessionId;
    case "DAY":
      return e.schoolDate === target.schoolDate;
    case "WEEK": {
      const w = weekRange(target.schoolDate);
      return e.schoolDate >= w.from && e.schoolDate <= w.to;
    }
    case "MONTH": {
      const m = monthRange(target.schoolDate);
      return e.schoolDate >= m.from && e.schoolDate <= m.to;
    }
    case "PERIOD":
      return e.periodId === target.periodId;
  }
}

const inScope = (scope: LimitScope, e: EntryScope, target: EntryScope) =>
  scope === "GLOBAL" || scopeValue(scope, e) === scopeValue(scope, target);

/** The session maximum (§3.1 step 5): the tightest LESSON rule, else `lessonMaxPoints`; never above the hard cap. */
export function sessionMaxPoints(rules: readonly LimitRule[], settings: LimitSettings, entry: EntryScope): Decimal {
  const lessonRules = applicableRules(rules, entry).filter((r) => r.window === "LESSON");
  const base = lessonRules.length ? Decimal.min(...lessonRules.map((r) => r.maxPoints)) : D(settings.lessonMaxPoints);
  return Decimal.min(base, settings.hardCapPerLesson);
}

/**
 * Every check the new entry must pass (§3.1 steps 2–4). Existing entries of the student from every teacher count,
 * reversals included (their points are negative). Returns the first violation, or null when the entry fits.
 */
export function checkLimits(
  rules: readonly LimitRule[],
  settings: LimitSettings,
  existing: readonly ExistingEntry[],
  entry: EntryScope,
  points: DecimalInput,
): LimitViolation | null {
  const checks: { window: LimitWindow; scopeType: LimitScope | "HARD_CAP"; max: DecimalInput }[] = [
    { window: "LESSON", scopeType: "HARD_CAP", max: settings.hardCapPerLesson },
    { window: "DAY", scopeType: "HARD_CAP", max: settings.hardCapPerDay },
  ];
  const rulesHere = applicableRules(rules, entry);
  // Without any LESSON rule the session maximum still bounds the lesson.
  if (!rulesHere.some((r) => r.window === "LESSON"))
    checks.push({ window: "LESSON", scopeType: "GLOBAL", max: settings.lessonMaxPoints });
  checks.push(...rulesHere.map((r) => ({ window: r.window, scopeType: r.scopeType, max: r.maxPoints })));

  for (const c of checks) {
    const scope = c.scopeType === "HARD_CAP" ? "GLOBAL" : c.scopeType;
    const used = sum(
      existing.filter((e) => inWindow(c.window, e, entry) && inScope(scope, e, entry)).map((e) => e.points),
    );
    const max = D(c.max);
    if (used.plus(points).gt(max))
      return { window: c.window, scopeType: c.scopeType, max, used, remaining: Decimal.max(max.minus(used), 0) };
  }
  return null;
}

/** What is left for the student today across all subjects (the journal's "left today: N"; Q-43). */
export function remainingToday(
  rules: readonly LimitRule[],
  settings: LimitSettings,
  existing: readonly ExistingEntry[],
  entry: EntryScope,
): Decimal {
  const dayChecks = [
    { scope: "GLOBAL" as LimitScope, max: D(settings.hardCapPerDay) },
    ...applicableRules(rules, entry)
      .filter((r) => r.window === "DAY")
      .map((r) => ({ scope: r.scopeType, max: D(r.maxPoints) })),
  ];
  const left = dayChecks.map((c) =>
    c.max.minus(
      sum(existing.filter((e) => inWindow("DAY", e, entry) && inScope(c.scope, e, entry)).map((e) => e.points)),
    ),
  );
  return Decimal.max(Decimal.min(...left), 0);
}

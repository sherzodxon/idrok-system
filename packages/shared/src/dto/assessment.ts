// M3 assessment policy configuration (docs/spec/scoring.md §6). Decimal values travel as strings (no float on the
// way); the API and the pure scoring functions turn them into Decimal.
import { z } from "zod";

/** Non-negative decimal with up to 4 fraction digits, as a string ("50", "1.5"). */
export const DecimalStringSchema = z.string().regex(/^\d{1,6}(\.\d{1,4})?$/, "validation.decimal");

export const DailyViewSchema = z.enum(["BY_SUBJECT", "OVERALL", "BOTH"]);
export const OverallMethodSchema = z.enum(["POOLED", "WEIGHTED_SUBJECTS"]);
export const ProgressViewSchema = z.enum(["DAY", "WEEK", "MONTH", "PERIOD"]);
export type ProgressView = z.infer<typeof ProgressViewSchema>;
export const ExcludeOrZeroSchema = z.enum(["EXCLUDE", "ZERO"]);
export const ComponentTypeSchema = z.enum(["DAILY_SCORES", "TESTS", "MANUAL"]);
export type ComponentType = z.infer<typeof ComponentTypeSchema>;
export const HigherAggregationSchema = z.enum(["AVERAGE", "WEIGHTED", "WEIGHTED_WITH_FINAL", "INDEPENDENT"]);
export type HigherAggregation = z.infer<typeof HigherAggregationSchema>;

export const PolicyComponentSchema = z.object({
  /** Stable key inside the version; MANUAL scores are entered against it. */
  key: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  type: ComponentTypeSchema,
  name: z.string().trim().min(1).max(100),
  maxPoints: DecimalStringSchema,
  enabled: z.boolean(),
});
export type PolicyComponent = z.infer<typeof PolicyComponentSchema>;

const HigherRuleFields = {
  aggregation: HigherAggregationSchema,
  /** WEIGHTED / WEIGHTED_WITH_FINAL: child periodId → relative weight. */
  weights: z.record(z.uuid(), DecimalStringSchema).optional(),
  /** WEIGHTED_WITH_FINAL: the final control, entered as a MANUAL score, with its relative weight. */
  finalComponent: z.object({ key: z.string().regex(/^[a-z0-9_-]{1,40}$/), weight: DecimalStringSchema }).optional(),
};

export const AssessmentConfigSchema = z.object({
  dailyView: DailyViewSchema,
  overallMethod: OverallMethodSchema,
  /** subjectId → weight for WEIGHTED_SUBJECTS; a subject not listed weighs 1. */
  subjectWeights: z.record(z.uuid(), DecimalStringSchema),
  enabledViews: z.array(ProgressViewSchema).min(1),
  absentExcused: ExcludeOrZeroSchema,
  absentUnexcused: ExcludeOrZeroSchema,
  ungradedPresentAs: z.enum(["PENDING", "ZERO"]),
  periodMaxPoints: DecimalStringSchema,
  components: z.array(PolicyComponentSchema).min(1).max(10),
  testsMode: z.enum(["COMBINED", "SEPARATE", "SELECTIVE"]),
  missedTest: ExcludeOrZeroSchema,
  retakePolicy: z.enum(["LAST", "BEST"]),
  emptyComponent: z.enum(["REDISTRIBUTE", "ZERO", "PENDING"]),
  /** Rules for periods made of other periods (half-year, year), by periodId. */
  higherPeriods: z.array(z.object({ periodId: z.uuid(), ...HigherRuleFields })),
  /** T-39: the rule for a higher period not listed above (the preset is reusable across years). */
  higherDefault: z.object(HigherRuleFields),
  overallPeriodResult: z.boolean(),
  rounding: z.object({ mode: z.enum(["HALF_UP", "FLOOR", "CEIL"]), decimals: z.number().int().min(0).max(2) }),
  gradeScaleId: z.uuid().nullable(),
});
export type AssessmentConfig = z.infer<typeof AssessmentConfigSchema>;

/** The default preset (scoring.md §6, open questions Q-08…Q-13 defaults). */
export const DEFAULT_ASSESSMENT_CONFIG: AssessmentConfig = {
  dailyView: "BOTH",
  overallMethod: "POOLED",
  subjectWeights: {},
  enabledViews: ["DAY", "WEEK", "MONTH", "PERIOD"],
  absentExcused: "EXCLUDE",
  absentUnexcused: "EXCLUDE",
  ungradedPresentAs: "PENDING",
  periodMaxPoints: "100",
  components: [
    { key: "daily", type: "DAILY_SCORES", name: "Kundalik ballar", maxPoints: "50", enabled: true },
    { key: "tests", type: "TESTS", name: "Testlar", maxPoints: "50", enabled: true },
  ],
  testsMode: "COMBINED",
  missedTest: "EXCLUDE",
  retakePolicy: "LAST",
  emptyComponent: "REDISTRIBUTE",
  higherPeriods: [],
  higherDefault: { aggregation: "AVERAGE" },
  overallPeriodResult: true,
  rounding: { mode: "HALF_UP", decimals: 0 },
  gradeScaleId: null,
};

export const GradeBandSchema = z.object({
  minPercent: DecimalStringSchema,
  maxPercent: DecimalStringSchema,
  label: z.string().trim().min(1).max(20),
});
export type GradeBand = z.infer<typeof GradeBandSchema>;

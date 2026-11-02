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

// ---- policies, versions, bindings and grade scales (API)

export const PolicyVersionStatusSchema = z.enum(["DRAFT", "PUBLISHED", "RETIRED"]);

export const PolicyVersionSchema = z.object({
  id: z.uuid(),
  policyId: z.uuid(),
  version: z.number().int(),
  status: PolicyVersionStatusSchema,
  config: AssessmentConfigSchema,
  note: z.string().nullable(),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
});
export type PolicyVersionDto = z.infer<typeof PolicyVersionSchema>;

export const AssessmentPolicySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  versions: z.array(PolicyVersionSchema.omit({ config: true })),
});
export type AssessmentPolicyDto = z.infer<typeof AssessmentPolicySchema>;

export const CreatePolicySchema = z
  .object({ name: z.string().trim().min(1).max(100), config: AssessmentConfigSchema.optional() })
  .strict();

export const SavePolicyDraftSchema = z
  .object({ config: AssessmentConfigSchema, note: z.string().trim().max(500).nullable().optional() })
  .strict();

export const PolicyBindingSchema = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  subjectId: z.uuid().nullable(),
  subjectName: z.string().nullable(),
  policyVersionId: z.uuid(),
  policyName: z.string(),
  version: z.number().int(),
  boundAt: z.string(),
  supersededAt: z.string().nullable(),
  reason: z.string().nullable(),
});
export type PolicyBindingDto = z.infer<typeof PolicyBindingSchema>;

export const BindPolicySchema = z
  .object({
    policyVersionId: z.uuid(),
    subjectId: z.uuid().nullable().default(null),
    /** Required when the period is already active ("apply to the current period"). */
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();

export const GradeScaleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isActive: z.boolean(),
  /** Used by a published policy version: its bands can no longer change. */
  inUse: z.boolean(),
  bands: z.array(GradeBandSchema),
});
export type GradeScaleDto = z.infer<typeof GradeScaleSchema>;

export const SaveGradeScaleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    isActive: z.boolean().optional(),
    bands: z.array(GradeBandSchema).min(1).max(20),
  })
  .strict();

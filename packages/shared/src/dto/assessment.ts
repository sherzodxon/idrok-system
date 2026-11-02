// M3 assessment policy configuration (docs/spec/scoring.md §6). Decimal values travel as strings (no float on the
// way); the API and the pure scoring functions turn them into Decimal.
import { z } from "zod";
import { SchoolDateSchema } from "./common";

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

// ---- progress, gradebook and period results (API)

export const SubjectProgressSchema = z.object({
  subjectId: z.uuid(),
  subjectName: z.string(),
  earned: z.string(),
  max: z.string(),
  /** Full precision; null = nothing counted yet (not 0%). */
  percent: z.string().nullable(),
  displayPercent: z.string().nullable(),
  scoredSessions: z.number().int(),
  pendingSessions: z.number().int(),
});

export const PeriodResultSchema = z.object({
  studentId: z.uuid(),
  studentName: z.string().optional(),
  subjectId: z.uuid().nullable(),
  subjectName: z.string().nullable(),
  periodId: z.uuid(),
  policyVersionId: z.uuid(),
  status: z.enum(["LIVE", "DRAFT", "FINAL"]),
  complete: z.boolean(),
  isStale: z.boolean(),
  components: z.array(
    z.object({
      key: z.string(),
      type: z.string(),
      maxPoints: z.string(),
      percent: z.string().nullable(),
      points: z.string().nullable(),
    }),
  ),
  totalPoints: z.string().nullable(),
  maxPoints: z.string(),
  percent: z.string().nullable(),
  displayPercent: z.string().nullable(),
  gradeLabel: z.string().nullable(),
  version: z.number().int().nullable(),
});
export type PeriodResultDto = z.infer<typeof PeriodResultSchema>;

export const ProgressQuerySchema = z.object({
  view: ProgressViewSchema.default("WEEK"),
  date: SchoolDateSchema.optional(),
});

export const StudentProgressSchema = z.object({
  studentId: z.uuid(),
  view: ProgressViewSchema,
  enabledViews: z.array(ProgressViewSchema),
  from: z.string(),
  to: z.string(),
  periodId: z.uuid().nullable(),
  periodName: z.string().nullable(),
  subjects: z.array(SubjectProgressSchema),
  /** Absent when the policy shows subjects only (BY_SUBJECT, §4.3). */
  overall: z.object({ percent: z.string().nullable(), displayPercent: z.string().nullable() }).optional(),
  /** Day by day overall (or pooled) percent, for the chart. */
  series: z.array(z.object({ date: z.string(), percent: z.string().nullable() })),
  periodResults: z.array(PeriodResultSchema),
  entries: z.array(
    z.object({
      id: z.uuid(),
      schoolDate: z.string(),
      subjectName: z.string(),
      topicTitle: z.string().nullable(),
      criterionName: z.string().nullable(),
      points: z.string(),
      kind: z.enum(["NORMAL", "REVERSAL"]),
    }),
  ),
});
export type StudentProgressDto = z.infer<typeof StudentProgressSchema>;

export const GradebookQuerySchema = z.object({
  teachingGroupId: z.uuid(),
  subjectId: z.uuid(),
  periodId: z.uuid(),
});

export const GradebookSchema = z.object({
  periodStatus: z.string(),
  /** Components entered by hand in this period (MANUAL ones and a higher period's final control). */
  manualComponents: z.array(
    z.object({ key: z.string(), name: z.string().nullable(), maxPoints: z.string(), final: z.boolean() }),
  ),
  sessions: z.array(
    z.object({
      id: z.uuid(),
      date: z.string(),
      lessonNumber: z.number().int(),
      status: z.string(),
      topicTitle: z.string().nullable(),
    }),
  ),
  students: z.array(
    z.object({
      studentId: z.uuid(),
      name: z.string(),
      cells: z.array(
        z.object({
          sessionId: z.uuid(),
          state: z.string(),
          points: z.string().nullable(),
          max: z.string(),
          attendance: z.string().nullable(),
        }),
      ),
      percent: z.string().nullable(),
      displayPercent: z.string().nullable(),
    }),
  ),
});
export type GradebookDto = z.infer<typeof GradebookSchema>;

export const PeriodResultQuerySchema = z.object({
  periodId: z.uuid(),
  teachingGroupId: z.uuid(),
  subjectId: z.uuid().optional(),
});

// ---- period closing, manual scores, missing-scores report

export const CloseReportSchema = z.object({
  students: z.number().int(),
  results: z.number().int(),
  incompleteResults: z.number().int(),
  emptyComponents: z.record(z.string(), z.number().int()),
  pendingByTeacher: z.array(
    z.object({ teacherId: z.uuid(), teacherName: z.string(), pendingSessions: z.number().int() }),
  ),
});

export const PeriodCloseRunSchema = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  status: z.enum(["PREPARED", "CLOSED", "CANCELLED"]),
  report: CloseReportSchema,
  preparedAt: z.string(),
  closedAt: z.string().nullable(),
});
export type PeriodCloseRunDto = z.infer<typeof PeriodCloseRunSchema>;

export const ClosePeriodSchema = z.object({ runId: z.uuid() }).strict();
export const RecomputePeriodSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export const ManualScoreSchema = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  subjectId: z.uuid(),
  studentId: z.uuid(),
  componentKey: z.string(),
  points: z.string(),
  maxPoints: z.string(),
  note: z.string().nullable(),
  enteredAt: z.string(),
});
export type ManualScoreDto = z.infer<typeof ManualScoreSchema>;

export const SaveManualScoreSchema = z
  .object({
    periodId: z.uuid(),
    subjectId: z.uuid(),
    studentId: z.uuid(),
    componentKey: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    points: z.coerce.string().pipe(DecimalStringSchema),
    maxPoints: z.coerce
      .string()
      .pipe(DecimalStringSchema)
      .refine((v) => Number(v) > 0, "validation.positive"),
    note: z.string().trim().max(300).nullable().optional(),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine((v) => Number(v.points) <= Number(v.maxPoints), { message: "points_above_max", path: ["points"] });

export const ManualScoreQuerySchema = z.object({
  periodId: z.uuid(),
  teachingGroupId: z.uuid(),
  subjectId: z.uuid(),
});

export const MissingScoresQuerySchema = z.object({ from: SchoolDateSchema, to: SchoolDateSchema });

export const MissingScoresRowSchema = z.object({
  teacherId: z.uuid(),
  teacherName: z.string(),
  lessons: z.number().int(),
  /** Lessons over with no score for anyone. */
  unscored: z.number().int(),
  /** Lessons over with no attendance mark for anyone. */
  unmarked: z.number().int(),
});

// M5 coins (MASTER_SPEC §14, api-plan.md §6): settings, criteria, limits, the ledger, the shop and automatic coins.
// Coins are whole numbers; they never mix with academic scores.
import { z } from "zod";
import { ListQuerySchema, SchoolDateSchema } from "./common";

export const COIN_LIMIT_SCOPES = [
  "GLOBAL",
  "CRITERION",
  "TEACHER",
  "TEACHER_CRITERION",
  "EACH_CRITERION",
  "EACH_TEACHER",
  "EACH_TEACHER_CRITERION",
] as const;
export const CoinLimitScopeSchema = z.enum(COIN_LIMIT_SCOPES);
export const CoinLimitPeriodSchema = z.enum(["DAY", "WEEK", "MONTH", "ROLLING"]);
export const CoinCriterionTypeSchema = z.enum(["REWARD", "PENALTY", "BOTH"]);
export const CoinDirectionSchema = z.enum(["REWARD", "PENALTY"]);
export const CoinTxTypeSchema = z.enum([
  "REWARD",
  "PENALTY",
  "PURCHASE",
  "REFUND",
  "ADMIN_ADJUSTMENT",
  "REVERSAL",
  "CORRECTION",
]);
export type CoinTxType = z.infer<typeof CoinTxTypeSchema>;
export const CoinTxSourceSchema = z.enum([
  "TEACHER_CRITERION",
  "ATTENDANCE",
  "TEST_RESULT",
  "ADMIN_ADJUST",
  "SHOP_PURCHASE",
  "REFUND",
  "OTHER",
]);
export const CoinOrderStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "DELIVERED", "CANCELLED"]);
export type CoinOrderStatus = z.infer<typeof CoinOrderStatusSchema>;

/** One evaluation or adjustment; large enough for any real case, small enough to catch a typo. */
const CoinAmountSchema = z.number().int().min(1).max(10_000);
const IdempotencyKeySchema = z.string().trim().min(8).max(100);
const ReasonSchema = z.string().trim().min(1).max(500);

// ---- settings

export const CoinSettingsSchema = z.object({
  isEnabled: z.boolean(),
  rewardsEnabled: z.boolean(),
  penaltiesEnabled: z.boolean(),
  teacherEvaluationEnabled: z.boolean(),
  adminAdjustmentEnabled: z.boolean(),
  autoCoinsEnabled: z.boolean(),
  shopEnabled: z.boolean(),
  newOrdersEnabled: z.boolean(),
  orderApprovalRequired: z.boolean(),
  allowNegativeBalance: z.boolean(),
  maxDebt: z.number().int().min(0).max(100_000).nullable(),
  activityWindowDays: z.number().int().min(1).max(90),
  activityMinCoverage: z.number().int().min(0).max(100),
  activityStaleDays: z.number().int().min(0).max(90),
});
export type CoinSettingsDto = z.infer<typeof CoinSettingsSchema>;
export const UpdateCoinSettingsSchema = CoinSettingsSchema.strict();

/** What every signed-in user may know: which parts are switched on (to show or hide menus). */
export const CoinStatusSchema = CoinSettingsSchema.pick({
  isEnabled: true,
  rewardsEnabled: true,
  penaltiesEnabled: true,
  teacherEvaluationEnabled: true,
  shopEnabled: true,
  newOrdersEnabled: true,
});
export type CoinStatusDto = z.infer<typeof CoinStatusSchema>;

// ---- criteria

export const CoinCriterionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  type: CoinCriterionTypeSchema,
  minAmount: z.number().int(),
  maxAmount: z.number().int(),
  subjectId: z.uuid().nullable(),
  subjectName: z.string().nullable(),
  eligibility: z.enum(["ALL_TEACHERS", "SELECTED_TEACHERS"]),
  isAutomatic: z.boolean(),
  isActive: z.boolean(),
  teacherIds: z.array(z.uuid()),
  transactionCount: z.number().int(),
});
export type CoinCriterionDto = z.infer<typeof CoinCriterionSchema>;

export const UpsertCoinCriterionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    type: CoinCriterionTypeSchema,
    minAmount: CoinAmountSchema,
    maxAmount: CoinAmountSchema,
    subjectId: z.uuid().nullable().optional(),
    eligibility: z.enum(["ALL_TEACHERS", "SELECTED_TEACHERS"]).optional(),
    isAutomatic: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.minAmount <= v.maxAmount, { message: "min_above_max", path: ["maxAmount"] });

export const SetCriterionTeachersSchema = z.object({ teacherIds: z.array(z.uuid()).max(500) }).strict();

// ---- limits

export const CoinLimitRuleSchema = z.object({
  id: z.uuid(),
  scope: CoinLimitScopeSchema,
  criterionId: z.uuid().nullable(),
  criterionName: z.string().nullable(),
  teacherId: z.uuid().nullable(),
  teacherName: z.string().nullable(),
  type: CoinDirectionSchema.nullable(),
  period: CoinLimitPeriodSchema,
  durationMinutes: z.number().int().nullable(),
  maxAmount: z.number().int().nullable(),
  maxCount: z.number().int().nullable(),
  countTypesSeparately: z.boolean(),
  isActive: z.boolean(),
});
export type CoinLimitRuleDto = z.infer<typeof CoinLimitRuleSchema>;

export const UpsertCoinLimitRuleSchema = z
  .object({
    scope: CoinLimitScopeSchema,
    criterionId: z.uuid().nullable().optional(),
    teacherId: z.uuid().nullable().optional(),
    type: CoinDirectionSchema.nullable().optional(),
    period: CoinLimitPeriodSchema,
    durationMinutes: z
      .number()
      .int()
      .min(1)
      .max(60 * 24 * 31)
      .nullable()
      .optional(),
    maxAmount: z.number().int().min(1).max(1_000_000).nullable().optional(),
    maxCount: z.number().int().min(1).max(10_000).nullable().optional(),
    countTypesSeparately: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.maxAmount == null && v.maxCount == null)
      ctx.addIssue({ code: "custom", message: "limit_empty", path: ["maxAmount"] });
    if ((v.period === "ROLLING") !== (v.durationMinutes != null))
      ctx.addIssue({ code: "custom", message: "duration_for_rolling", path: ["durationMinutes"] });
    const needsCriterion = v.scope === "CRITERION" || v.scope === "TEACHER_CRITERION";
    const needsTeacher = v.scope === "TEACHER" || v.scope === "TEACHER_CRITERION";
    if (needsCriterion !== (v.criterionId != null))
      ctx.addIssue({ code: "custom", message: "scope_criterion", path: ["criterionId"] });
    if (needsTeacher !== (v.teacherId != null))
      ctx.addIssue({ code: "custom", message: "scope_teacher", path: ["teacherId"] });
  });

/** Why a limit refused an evaluation (structured: the client translates it). */
export const CoinLimitReasonSchema = z.object({
  limitId: z.string(),
  scope: CoinLimitScopeSchema,
  period: CoinLimitPeriodSchema,
  durationMinutes: z.number().int().nullable(),
  typeMode: z.enum(["REWARD", "PENALTY", "BOTH_SHARED", "BOTH_SEPARATE"]),
  blockedBy: z.enum(["AMOUNT", "COUNT"]),
  maxAmount: z.number().int().nullable(),
  usedAmount: z.number().int(),
  remainingAmount: z.number().int().nullable(),
  maxCount: z.number().int().nullable(),
  usedCount: z.number().int(),
  remainingCount: z.number().int().nullable(),
  availableAt: z.string().nullable(),
});
export type CoinLimitReasonDto = z.infer<typeof CoinLimitReasonSchema>;

// ---- ledger

export const CoinTransactionSchema = z.object({
  id: z.uuid(),
  studentId: z.uuid(),
  studentName: z.string(),
  type: CoinTxTypeSchema,
  source: CoinTxSourceSchema,
  amount: z.number().int(),
  balanceAfter: z.number().int(),
  schoolDate: SchoolDateSchema,
  criterionId: z.uuid().nullable(),
  criterionName: z.string().nullable(),
  teacherId: z.uuid().nullable(),
  teacherName: z.string().nullable(),
  reason: z.string().nullable(),
  reversesTransactionId: z.uuid().nullable(),
  correctsTransactionId: z.uuid().nullable(),
  /** REWARD / PENALTY / ADMIN_ADJUSTMENT: whether it was undone. */
  reversed: z.boolean(),
  /** REWARD / PENALTY: the amount after corrections (null for other types). */
  effectiveAmount: z.number().int().nullable(),
  orderId: z.uuid().nullable(),
  createdAt: z.string(),
});
export type CoinTransactionDto = z.infer<typeof CoinTransactionSchema>;

export const CoinTransactionQuerySchema = ListQuerySchema.extend({
  studentId: z.uuid().optional(),
  teacherId: z.uuid().optional(),
  criterionId: z.uuid().optional(),
  type: CoinTxTypeSchema.optional(),
  source: CoinTxSourceSchema.optional(),
  from: SchoolDateSchema.optional(),
  to: SchoolDateSchema.optional(),
});

export const GiveCoinsSchema = z
  .object({
    studentId: z.uuid(),
    criterionId: z.uuid(),
    /** Required for a BOTH criterion; must match a one-way criterion. */
    type: CoinDirectionSchema.optional(),
    amount: CoinAmountSchema,
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();
export type GiveCoinsInput = z.infer<typeof GiveCoinsSchema>;

export const CoinAdjustmentSchema = z
  .object({
    studentId: z.uuid(),
    amount: z
      .number()
      .int()
      .min(-100_000)
      .max(100_000)
      .refine((v) => v !== 0, "validation.non_zero"),
    reason: ReasonSchema,
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();

/** The reason is optional only for a teacher undoing their own evaluation the same day (checked by the API). */
export const ReverseCoinSchema = z
  .object({ reason: ReasonSchema.optional(), idempotencyKey: IdempotencyKeySchema })
  .strict();
export const CorrectCoinSchema = z
  .object({
    amount: z.number().int().min(-10_000).max(10_000),
    reason: ReasonSchema,
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();

export const CoinWriteResultSchema = z.object({
  transaction: CoinTransactionSchema,
  balance: z.number().int(),
  duplicate: z.boolean(),
});
export type CoinWriteResultDto = z.infer<typeof CoinWriteResultSchema>;

// ---- teacher: quick evaluation

export const CoinCapacitySchema = z.object({
  remainingCount: z.number().int().nullable(),
  remainingAmount: z.number().int().nullable(),
  blocked: CoinLimitReasonSchema.nullable(),
});
export type CoinCapacityDto = z.infer<typeof CoinCapacitySchema>;

export const TeacherCoinCriterionSchema = CoinCriterionSchema.pick({
  id: true,
  name: true,
  description: true,
  type: true,
  minAmount: true,
  maxAmount: true,
  subjectId: true,
  subjectName: true,
});
export type TeacherCoinCriterionDto = z.infer<typeof TeacherCoinCriterionSchema>;

export const TeacherCoinStudentSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  className: z.string().nullable(),
  /** Teaching groups (of the teacher) the student is in — for the class filter. */
  groupIds: z.array(z.uuid()),
  balance: z.number().int(),
  /** Evaluations given to the student today by this teacher. */
  todayByMe: z.number().int(),
});
export type TeacherCoinStudentDto = z.infer<typeof TeacherCoinStudentSchema>;

export const TeacherCoinBoardSchema = z.object({
  groups: z.array(z.object({ id: z.uuid(), name: z.string(), subjectName: z.string() })),
  students: z.array(TeacherCoinStudentSchema),
  criteria: z.array(TeacherCoinCriterionSchema),
});
export type TeacherCoinBoardDto = z.infer<typeof TeacherCoinBoardSchema>;

export const CapacityQuerySchema = z.object({ criterionId: z.uuid(), type: CoinDirectionSchema.optional() });

// ---- student summary

export const CoinSummarySchema = z.object({
  studentId: z.uuid(),
  balance: z.number().int(),
  earned: z.number().int(),
  penalties: z.number().int(),
  spent: z.number().int(),
  /** Debt floor when debt is allowed (null: no debt / no floor). */
  maxDebt: z.number().int().nullable(),
  /** Last 30 school days: net change per day. */
  series: z.array(z.object({ date: SchoolDateSchema, earned: z.number().int(), penalties: z.number().int() })),
});
export type CoinSummaryDto = z.infer<typeof CoinSummarySchema>;

// ---- shop

export const CoinProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  hasImage: z.boolean(),
  price: z.number().int(),
  stock: z.number().int(),
  isVisible: z.boolean(),
  archived: z.boolean(),
});
export type CoinProductDto = z.infer<typeof CoinProductSchema>;

export const UpsertCoinProductSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    price: z.number().int().min(1).max(1_000_000),
    stock: z.number().int().min(0).max(100_000),
    isVisible: z.boolean().optional(),
  })
  .strict();

export const CatalogItemSchema = CoinProductSchema.omit({ isVisible: true, archived: true }).extend({
  affordable: z.boolean(),
});
export type CatalogItemDto = z.infer<typeof CatalogItemSchema>;
export const CatalogSchema = z.object({
  balance: z.number().int(),
  canOrder: z.boolean(),
  /** Why ordering is off: SHOP_CLOSED / ORDERS_PAUSED / IN_DEBT. */
  blockedReason: z.enum(["SHOP_CLOSED", "ORDERS_PAUSED", "IN_DEBT"]).nullable(),
  items: z.array(CatalogItemSchema),
});
export type CatalogDto = z.infer<typeof CatalogSchema>;

export const CoinOrderSchema = z.object({
  id: z.uuid(),
  studentId: z.uuid(),
  studentName: z.string(),
  className: z.string().nullable(),
  productId: z.uuid(),
  productName: z.string(),
  hasImage: z.boolean(),
  price: z.number().int(),
  status: CoinOrderStatusSchema,
  note: z.string().nullable(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  closedAt: z.string().nullable(),
});
export type CoinOrderDto = z.infer<typeof CoinOrderSchema>;

export const CreateCoinOrderSchema = z.object({ productId: z.uuid(), idempotencyKey: IdempotencyKeySchema }).strict();
export const CoinOrderActionSchema = z.object({ note: z.string().trim().max(500).optional() }).strict();
export const CoinOrderQuerySchema = ListQuerySchema.extend({
  status: CoinOrderStatusSchema.optional(),
  studentId: z.uuid().optional(),
});
export const CoinOrderPageSchema = z.object({
  items: z.array(CoinOrderSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  statusCounts: z.record(z.string(), z.number().int()),
});

// ---- automatic coins

export const TestResultRuleConfigSchema = z
  .object({
    minPercent: z.number().min(0).max(100),
    amount: CoinAmountSchema,
    /** Empty = every test. */
    purposes: z
      .array(z.enum(["PRACTICE", "WEIGHTED"]))
      .max(2)
      .default([]),
  })
  .strict();
export type TestResultRuleConfig = z.infer<typeof TestResultRuleConfigSchema>;

export const CoinAutoRuleSchema = z.object({
  id: z.uuid(),
  source: z.enum(["TEST_RESULT", "ATTENDANCE"]),
  criterionId: z.uuid(),
  criterionName: z.string(),
  config: TestResultRuleConfigSchema,
  isActive: z.boolean(),
});
export type CoinAutoRuleDto = z.infer<typeof CoinAutoRuleSchema>;

export const UpsertCoinAutoRuleSchema = z
  .object({
    source: z.literal("TEST_RESULT"),
    criterionId: z.uuid(),
    config: TestResultRuleConfigSchema,
    isActive: z.boolean().optional(),
  })
  .strict();

// ---- overview (admin dashboard)

export const CoinRangeQuerySchema = z.object({
  from: SchoolDateSchema.optional(),
  to: SchoolDateSchema.optional(),
});

export const CoinOverviewSchema = z.object({
  from: SchoolDateSchema,
  to: SchoolDateSchema,
  awarded: z.number().int(),
  penalties: z.number().int(),
  spent: z.number().int(),
  automatic: z.number().int(),
  adjustments: z.number().int(),
  evaluations: z.number().int(),
  totalBalance: z.number().int(),
  studentsInDebt: z.number().int(),
  pendingOrders: z.number().int(),
  byCriterion: z.array(
    z.object({
      id: z.uuid().nullable(),
      name: z.string(),
      awarded: z.number().int(),
      penalties: z.number().int(),
      count: z.number().int(),
    }),
  ),
  series: z.array(z.object({ date: SchoolDateSchema, awarded: z.number().int(), penalties: z.number().int() })),
});
export type CoinOverviewDto = z.infer<typeof CoinOverviewSchema>;

export const CoinRankingQuerySchema = z.object({
  classGroupId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const CoinRankingSchema = z.array(
  z.object({
    studentId: z.uuid(),
    name: z.string(),
    className: z.string().nullable(),
    balance: z.number().int(),
  }),
);

export const TeacherActivitySchema = z.object({
  rule: z.object({ windowDays: z.number().int(), minCoverage: z.number().int(), staleDays: z.number().int() }),
  teachers: z.array(
    z.object({
      teacherId: z.uuid(),
      name: z.string(),
      status: z.enum(["ACTIVE", "LOW_ACTIVITY", "INACTIVE", "UNASSIGNED"]),
      reason: z.enum(["NO_CRITERIA", "NO_STUDENTS", "NONE_IN_WINDOW", "LOW_COVERAGE", "STALE", "OK"]),
      assignedStudents: z.number().int(),
      eligibleCriteria: z.number().int(),
      windowEvaluations: z.number().int(),
      windowStudents: z.number().int(),
      coverage: z.number().int(),
      penaltyShare: z.number().int(),
      lastEvaluation: SchoolDateSchema.nullable(),
      daysSinceLast: z.number().int().nullable(),
    }),
  ),
});
export type TeacherActivityDto = z.infer<typeof TeacherActivitySchema>;

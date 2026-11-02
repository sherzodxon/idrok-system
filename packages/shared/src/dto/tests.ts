// M4 tests (docs/spec/tests.md). Teacher DTOs carry the answer key; student DTOs never do (security-baseline.md S4):
// they are separate schemas, not a shared one with optional fields.
import { z } from "zod";
import { ListQuerySchema } from "./common";
import { DecimalStringSchema } from "./assessment";

export const QuestionTypeSchema = z.enum(["SINGLE", "MULTIPLE", "SHORT_TEXT", "MATCHING"]);
export type QuestionTypeCode = z.infer<typeof QuestionTypeSchema>;
export const QuestionDifficultySchema = z.enum(["EASY", "MEDIUM", "HARD"]);
export type QuestionDifficultyCode = z.infer<typeof QuestionDifficultySchema>;

const Text = z.string().trim().min(1).max(4000);
const ShortText = z.string().trim().min(1).max(500);
/** Option and pair ids are short client-chosen keys inside one version ("a", "b", ... or a uuid). */
const LocalId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

export const QuestionOptionSchema = z.object({ id: LocalId, text: ShortText, isCorrect: z.boolean() });
export const MatchingPairSchema = z.object({ leftId: LocalId, left: ShortText, rightId: LocalId, right: ShortText });

/** The content of one version; any change to it is a new version. */
export const QuestionContentSchema = z.object({
  type: QuestionTypeSchema,
  text: Text,
  points: z.coerce
    .string()
    .pipe(DecimalStringSchema)
    .refine((v) => Number(v) > 0, "validation.positive")
    .default("1"),
  options: z.array(QuestionOptionSchema).max(10).default([]),
  acceptedAnswers: z.array(ShortText).max(20).nullable().optional(),
  pairs: z.array(MatchingPairSchema).max(10).nullable().optional(),
  explanation: z.string().trim().max(2000).nullable().optional(),
  imageAssetId: z.uuid().nullable().optional(),
});
export type QuestionContent = z.infer<typeof QuestionContentSchema>;

export const CreateQuestionSchema = QuestionContentSchema.extend({
  subjectId: z.uuid(),
  gradeId: z.uuid(),
  topicId: z.uuid().nullable().optional(),
  difficulty: QuestionDifficultySchema.default("MEDIUM"),
  sharedWithSubject: z.boolean().default(false),
}).strict();

/** Metadata changes in place; `content` (when given) becomes a new version. */
export const UpdateQuestionSchema = z
  .object({
    topicId: z.uuid().nullable(),
    difficulty: QuestionDifficultySchema,
    sharedWithSubject: z.boolean(),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
    content: QuestionContentSchema.omit({ type: true }),
  })
  .partial()
  .strict();

export const QuestionVersionSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  text: z.string(),
  points: z.string(),
  options: z.array(QuestionOptionSchema),
  acceptedAnswers: z.array(z.string()).nullable(),
  pairs: z.array(MatchingPairSchema).nullable(),
  explanation: z.string().nullable(),
  imageAssetId: z.uuid().nullable(),
  createdAt: z.string(),
});
export type QuestionVersionDto = z.infer<typeof QuestionVersionSchema>;

/** Teacher view, with the answer key. */
export const QuestionSchema = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  ownerName: z.string(),
  subjectId: z.uuid(),
  subjectName: z.string(),
  gradeId: z.uuid(),
  gradeName: z.string(),
  topicId: z.uuid().nullable(),
  topicTitle: z.string().nullable(),
  type: QuestionTypeSchema,
  difficulty: QuestionDifficultySchema,
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  sharedWithSubject: z.boolean(),
  /** The caller owns it (only the owner edits; colleagues of the subject see shared ones). */
  mine: z.boolean(),
  /** Used in an earlier test given to the group asked about (`?teachingGroupId=`), any version. */
  usedWithGroup: z.boolean().optional(),
  /** Used in any test: an edit keeps the old version for those tests. */
  usedInTests: z.number().int(),
  current: QuestionVersionSchema,
});
export type QuestionDto = z.infer<typeof QuestionSchema>;

export const QuestionListQuerySchema = ListQuerySchema.extend({
  subjectId: z.uuid().optional(),
  gradeId: z.uuid().optional(),
  /** a topic id, or "none" for questions without a topic */
  topicId: z.union([z.uuid(), z.literal("none")]).optional(),
  type: QuestionTypeSchema.optional(),
  difficulty: QuestionDifficultySchema.optional(),
  scope: z.enum(["mine", "shared", "all"]).default("all"),
  status: z.enum(["ACTIVE", "ARCHIVED"]).default("ACTIVE"),
  teachingGroupId: z.uuid().optional(),
});
export type QuestionListQuery = z.infer<typeof QuestionListQuerySchema>;

export const QuestionImportOptionsSchema = z
  .object({ subjectId: z.uuid(), gradeId: z.uuid(), sharedWithSubject: z.boolean().default(false) })
  .strict();

export const QuestionExportQuerySchema = z.object({
  subjectId: z.uuid(),
  gradeId: z.uuid().optional(),
  scope: z.enum(["mine", "all"]).default("mine"),
  locale: z.enum(["uz", "ru"]).default("uz"),
});

export const TestTypeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
});
export type TestTypeDto = z.infer<typeof TestTypeSchema>;

export const CreateTestTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_]{2,30}$/),
  })
  .strict();
export const UpdateTestTypeSchema = z
  .object({ name: z.string().trim().min(1).max(80), isActive: z.boolean() })
  .partial()
  .strict();

// ---------------------------------------------------------------- tests (§2, §4.1, §6, §7)

export const TestFormatSchema = z.enum(["ONLINE", "OFFLINE"]);
export const TestPurposeSchema = z.enum(["PRACTICE", "WEIGHTED"]);
export const TestStatusSchema = z.enum(["DRAFT", "SCHEDULED", "OPEN", "CLOSED", "ARCHIVED"]);
export type TestStatusCode = z.infer<typeof TestStatusSchema>;
export const ShowResultSchema = z.enum(["IMMEDIATE", "AFTER_CLOSE", "NEVER"]);
export const MultipleScoringSchema = z.enum(["ALL_OR_NOTHING", "PARTIAL"]);
export const OFFLINE_MAX_SCORES = ["5", "10", "20", "25", "40", "50", "100"] as const;

export const PoolRuleSchema = z.object({
  topicId: z.uuid().nullable(),
  difficulty: QuestionDifficultySchema.nullable(),
  count: z.number().int().min(1).max(200),
});
export const TestSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("MANUAL") }),
  z.object({ mode: z.literal("POOL"), rules: z.array(PoolRuleSchema).min(1).max(20) }),
]);
export type TestSelection = z.infer<typeof TestSelectionSchema>;

const Instant = z.iso.datetime({ offset: true });

const TestFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable(),
  testTypeId: z.uuid(),
  startsAt: Instant.nullable(),
  endsAt: Instant.nullable(),
  /** OFFLINE: the day it is written (YYYY-MM-DD). */
  schoolDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  timeLimitMinutes: z.number().int().min(1).max(600).nullable(),
  questionCount: z.number().int().min(1).max(200).nullable(),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  selection: TestSelectionSchema,
  /** OFFLINE only: the scale (Q-45); ONLINE: the sum of the question points (computed). */
  maxScore: z.enum(OFFLINE_MAX_SCORES).nullable(),
  multipleScoring: MultipleScoringSchema,
  periodId: z.uuid().nullable(),
  weight: z.coerce
    .string()
    .pipe(DecimalStringSchema)
    .refine((v) => Number(v) > 0, "validation.positive")
    .nullable(),
  includedInAssessment: z.boolean(),
  retakePolicy: z.enum(["LAST", "BEST"]),
  violationThreshold: z.number().int().min(0).max(20),
  showResultToStudent: ShowResultSchema,
  planItemId: z.uuid().nullable(),
  assignTo: z.object({
    teachingGroupIds: z.array(z.uuid()).max(30).default([]),
    studentIds: z.array(z.uuid()).max(300).default([]),
  }),
};

export const CreateTestSchema = z
  .object({
    ...TestFields,
    subjectId: z.uuid(),
    gradeId: z.uuid(),
    format: TestFormatSchema,
    purpose: TestPurposeSchema,
    /** School-wide roles may create a test for a teacher; a teacher always for themself. */
    teacherId: z.uuid().optional(),
  })
  .partial({
    description: true,
    startsAt: true,
    endsAt: true,
    schoolDate: true,
    timeLimitMinutes: true,
    questionCount: true,
    maxScore: true,
    periodId: true,
    weight: true,
    planItemId: true,
  })
  .extend({
    shuffleQuestions: z.boolean().default(true),
    shuffleOptions: z.boolean().default(true),
    selection: TestSelectionSchema.default({ mode: "MANUAL" }),
    multipleScoring: MultipleScoringSchema.default("ALL_OR_NOTHING"),
    includedInAssessment: z.boolean().default(true),
    retakePolicy: z.enum(["LAST", "BEST"]).default("LAST"),
    violationThreshold: z.number().int().min(0).max(20).default(3),
    showResultToStudent: ShowResultSchema.default("AFTER_CLOSE"),
    assignTo: TestFields.assignTo.default({ teachingGroupIds: [], studentIds: [] }),
  })
  .strict();

/**
 * DRAFT: everything. Published and not closed: title, description and the window (`applyToRunning` also moves the
 * deadlines of attempts already started — §5).
 */
export const UpdateTestSchema = z
  .object({ ...TestFields, applyToRunning: z.boolean() })
  .partial()
  .strict();

export const SetTestQuestionsSchema = z
  .object({
    questions: z
      .array(
        z.object({
          questionId: z.uuid(),
          points: z.coerce
            .string()
            .pipe(DecimalStringSchema)
            .refine((v) => Number(v) > 0, "validation.positive")
            .optional(),
        }),
      )
      .max(200),
  })
  .strict();

export const TestQuestionSchema = z.object({
  id: z.uuid(),
  order: z.number().int(),
  points: z.string(),
  questionId: z.uuid(),
  topicId: z.uuid().nullable(),
  topicTitle: z.string().nullable(),
  difficulty: QuestionDifficultySchema,
  type: QuestionTypeSchema,
  version: QuestionVersionSchema,
  /** The bank has a newer version (a DRAFT takes it on publish). */
  newerVersion: z.boolean(),
});

export const TestSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  subjectId: z.uuid(),
  subjectName: z.string(),
  gradeId: z.uuid(),
  gradeName: z.string(),
  teacherId: z.uuid(),
  teacherName: z.string(),
  testTypeId: z.uuid(),
  testTypeCode: z.string(),
  testTypeName: z.string(),
  format: TestFormatSchema,
  purpose: TestPurposeSchema,
  status: TestStatusSchema,
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  schoolDate: z.string().nullable(),
  timeLimitMinutes: z.number().int().nullable(),
  questionCount: z.number().int().nullable(),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  selection: TestSelectionSchema,
  maxScore: z.string(),
  multipleScoring: MultipleScoringSchema,
  periodId: z.uuid().nullable(),
  periodName: z.string().nullable(),
  weight: z.string().nullable(),
  includedInAssessment: z.boolean(),
  retakePolicy: z.enum(["LAST", "BEST"]),
  violationThreshold: z.number().int(),
  showResultToStudent: ShowResultSchema,
  planItemId: z.uuid().nullable(),
  assignments: z.array(
    z.object({ teachingGroupId: z.uuid().nullable(), studentId: z.uuid().nullable(), name: z.string() }),
  ),
  questionsTotal: z.number().int(),
  attempts: z.number().int(),
  publishedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TestDto = z.infer<typeof TestSchema>;

export const TestDetailSchema = TestSchema.extend({ questions: z.array(TestQuestionSchema) });
export type TestDetailDto = z.infer<typeof TestDetailSchema>;

export const TestListQuerySchema = ListQuerySchema.extend({
  subjectId: z.uuid().optional(),
  gradeId: z.uuid().optional(),
  teachingGroupId: z.uuid().optional(),
  periodId: z.uuid().optional(),
  status: TestStatusSchema.optional(),
  format: TestFormatSchema.optional(),
  purpose: TestPurposeSchema.optional(),
});

export const TestProblemSchema = z.enum([
  "NO_QUESTIONS",
  "TOO_MANY_QUESTIONS",
  "QUESTION_COUNT_ABOVE_POOL",
  "POOL_RULE_UNFILLABLE",
  "QUESTION_INVALID",
  "WINDOW_INVALID",
  "WINDOW_IN_PAST",
  "WEIGHTED_NEEDS_PERIOD",
  "PERIOD_CLOSED",
  "NO_ASSIGNMENT",
  "OFFLINE_NEEDS_DATE",
  "OFFLINE_SCALE",
]);
export type TestProblem = z.infer<typeof TestProblemSchema>;

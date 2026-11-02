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

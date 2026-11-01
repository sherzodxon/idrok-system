// M2 curriculum plans (calendar-thematic plans) and topics (docs/spec/lesson-plan.md §4).
import { z } from "zod";
import { ListQuerySchema } from "./common";

export const LessonTypeSchema = z.enum(["NEW", "PRACTICE", "REVIEW", "CONTROL_WORK", "BSB", "CHSB", "LAB", "OTHER"]);
export type LessonTypeCode = z.infer<typeof LessonTypeSchema>;
export const CurriculumPlanStatusSchema = z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "ARCHIVED"]);

const LongText = z.string().trim().max(2000);

export const TopicSchema = z.object({
  id: z.uuid(),
  subjectId: z.uuid(),
  gradeId: z.uuid(),
  title: z.string(),
  code: z.string().nullable(),
});
export type TopicDto = z.infer<typeof TopicSchema>;

export const TopicQuerySchema = z.object({
  subjectId: z.uuid(),
  gradeId: z.uuid(),
  q: z.string().trim().max(100).optional(),
});

export const CreateTopicSchema = z
  .object({
    subjectId: z.uuid(),
    gradeId: z.uuid(),
    title: z.string().trim().min(1).max(300),
    code: z.string().trim().max(30).nullable().optional(),
  })
  .strict();

export const PlanItemInputSchema = z
  .object({
    /** An existing topic of the plan's subject and grade … */
    topicId: z.uuid().optional(),
    /** … or a title: matched to an existing topic (normalised text) or created. */
    topicTitle: z.string().trim().min(1).max(300).optional(),
    hours: z.number().int().min(1).max(100),
    lessonType: LessonTypeSchema.default("NEW"),
    periodId: z.uuid().nullable().optional(),
    objectives: LongText.nullable().optional(),
    homework: LongText.nullable().optional(),
    resources: LongText.nullable().optional(),
    notes: LongText.nullable().optional(),
  })
  .strict()
  .refine((v) => !!v.topicId !== !!v.topicTitle, { path: ["topicTitle"], message: "topic_required" });
export type PlanItemInput = z.input<typeof PlanItemInputSchema>;

export const PlanItemSchema = z.object({
  id: z.uuid(),
  order: z.number().int(),
  topicId: z.uuid(),
  topicTitle: z.string(),
  hours: z.number().int(),
  lessonType: LessonTypeSchema,
  periodId: z.uuid().nullable(),
  objectives: z.string().nullable(),
  homework: z.string().nullable(),
  resources: z.string().nullable(),
  notes: z.string().nullable(),
});
export type PlanItemDto = z.infer<typeof PlanItemSchema>;

export const CurriculumPlanSummarySchema = z.object({
  id: z.uuid(),
  lineageId: z.uuid(),
  version: z.number().int(),
  academicYearId: z.uuid(),
  subjectId: z.uuid(),
  subjectName: z.string(),
  gradeId: z.uuid(),
  gradeName: z.string(),
  title: z.string(),
  status: CurriculumPlanStatusSchema,
  authorId: z.uuid().nullable(),
  authorName: z.string().nullable(),
  itemCount: z.number().int(),
  totalHours: z.number().int(),
  submittedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  rejectionNote: z.string().nullable(),
  updatedAt: z.string(),
  /** The caller may edit, submit or start a new version. */
  canEdit: z.boolean(),
});
export type CurriculumPlanSummaryDto = z.infer<typeof CurriculumPlanSummarySchema>;

export const CurriculumPlanDetailSchema = CurriculumPlanSummarySchema.extend({
  items: z.array(PlanItemSchema),
  /** Every version of this plan, newest first. */
  versions: z.array(z.object({ id: z.uuid(), version: z.number().int(), status: CurriculumPlanStatusSchema })),
});
export type CurriculumPlanDetailDto = z.infer<typeof CurriculumPlanDetailSchema>;

export const CurriculumPlanListQuerySchema = ListQuerySchema.extend({
  academicYearId: z.uuid().optional(),
  subjectId: z.uuid().optional(),
  gradeId: z.uuid().optional(),
  status: CurriculumPlanStatusSchema.optional(),
  mine: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export const CreateCurriculumPlanSchema = z
  .object({
    academicYearId: z.uuid(),
    subjectId: z.uuid(),
    gradeId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    items: z.array(PlanItemInputSchema).max(400).default([]),
  })
  .strict();

export const UpdateCurriculumPlanSchema = z
  .object({ title: z.string().trim().min(1).max(200), items: z.array(PlanItemInputSchema).max(400) })
  .partial()
  .strict();

export const RejectCurriculumPlanSchema = z.object({ note: z.string().trim().min(1).max(1000) }).strict();

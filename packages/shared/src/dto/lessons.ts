// M2 lesson sessions: generation preview/apply (lesson-plan.md §3) and lesson lists.
import { z } from "zod";
import { SchoolDateSchema } from "./common";

export const LessonGenerationRequestSchema = z
  .object({
    /** Also create lessons for past dates — only for the first generation of a year (T-36). */
    includePast: z.boolean().default(false),
  })
  .strict();

export const LessonGenerationApplySchema = LessonGenerationRequestSchema.extend({ previewHash: z.string().length(64) });

const LessonRefSchema = z.object({
  date: z.string(),
  lessonNumber: z.number().int(),
  teachingGroupId: z.uuid(),
  teachingGroupName: z.string(),
  subjectName: z.string(),
  status: z.string().optional(),
});

export const LessonGenerationPreviewSchema = z.object({
  previewHash: z.string(),
  from: z.string(),
  to: z.string(),
  add: z.number().int(),
  update: z.number().int(),
  cancel: z.number().int(),
  unchanged: z.number().int(),
  /** Up to 50 lessons the change would cancel — the admin should see them before applying. */
  cancelSample: z.array(LessonRefSchema),
  /** Lessons the timetable wants changed but that are held, manual or locked. */
  blocked: z.array(LessonRefSchema),
  warnings: z.object({
    noPeriodDates: z.array(z.string()),
    noBellSlot: z.number().int(),
  }),
});
export type LessonGenerationPreviewDto = z.infer<typeof LessonGenerationPreviewSchema>;

export const LessonGenerationResultSchema = z.object({
  added: z.number().int(),
  updated: z.number().int(),
  cancelled: z.number().int(),
});

export const LessonSessionStatusSchema = z.enum(["SCHEDULED", "HELD", "CANCELLED", "MOVED"]);

export const LessonSessionSchema = z.object({
  id: z.uuid(),
  date: z.string(),
  lessonNumber: z.number().int(),
  startsAt: z.string(),
  endsAt: z.string(),
  teachingGroupId: z.uuid(),
  teachingGroupName: z.string(),
  classGroupId: z.uuid().nullable(),
  subjectId: z.uuid(),
  subjectName: z.string(),
  teacherId: z.uuid(),
  teacherName: z.string(),
  substituteTeacherId: z.uuid().nullable(),
  substituteTeacherName: z.string().nullable(),
  periodId: z.uuid(),
  sequenceNo: z.number().int(),
  status: LessonSessionStatusSchema,
  source: z.enum(["TIMETABLE", "MANUAL"]),
  cancelReason: z.string().nullable(),
});
export type LessonSessionDto = z.infer<typeof LessonSessionSchema>;

export const LessonSessionQuerySchema = z.object({
  from: SchoolDateSchema,
  to: SchoolDateSchema,
  teachingGroupId: z.uuid().optional(),
  classGroupId: z.uuid().optional(),
  subjectId: z.uuid().optional(),
  teacherId: z.uuid().optional(),
  includeCancelled: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export const SetSubstituteSchema = z.object({ substituteTeacherId: z.uuid().nullable() }).strict();

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
  /** The planned topic (lesson-plan.md §4.4) and what was actually taught (§4.7). */
  planItemId: z.uuid().nullable(),
  topicTitle: z.string().nullable(),
  lessonType: z.string().nullable(),
  homework: z.string().nullable(),
  actualTopicNote: z.string().nullable(),
  heldMarkedAt: z.string().nullable(),
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

export const MarkHeldSchema = z
  .object({
    /** Another topic of the group's plan was taught instead of the planned one. */
    planItemId: z.uuid().nullable().optional(),
    actualTopicNote: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const CancelLessonSchema = z.object({ reason: z.string().trim().min(1).max(300) }).strict();

export const CancelLessonResultSchema = z.object({
  lesson: LessonSessionSchema,
  /** The plan applied to this group and subject: its topics can be moved on (reflow, §4.6). */
  planAssignmentId: z.uuid().nullable(),
});

/** Portal: one student's lessons of a week with topic and homework (lesson-plan.md §6). */
export const PortalWeekQuerySchema = z.object({
  date: SchoolDateSchema.optional(),
  /** Guardians choose the child; students see themselves. */
  studentId: z.uuid().optional(),
});

export const PortalLessonSchema = z.object({
  id: z.uuid(),
  date: z.string(),
  lessonNumber: z.number().int(),
  startsAt: z.string(),
  endsAt: z.string(),
  subjectName: z.string(),
  teacherName: z.string(),
  status: LessonSessionStatusSchema,
  topicTitle: z.string().nullable(),
  homework: z.string().nullable(),
});
export const PortalWeekSchema = z.object({
  from: z.string(),
  to: z.string(),
  studentId: z.uuid(),
  lessons: z.array(PortalLessonSchema),
});
export type PortalWeekDto = z.infer<typeof PortalWeekSchema>;

/** "Darslar soni": planned hours against lessons per group and subject (lesson-plan.md §3). */
export const LessonCountQuerySchema = z.object({
  academicYearId: z.uuid(),
  periodId: z.uuid().optional(),
  classGroupId: z.uuid().optional(),
});
export const LessonCountRowSchema = z.object({
  teachingGroupId: z.uuid(),
  teachingGroupName: z.string(),
  subjectId: z.uuid(),
  subjectName: z.string(),
  lessons: z.number().int(),
  held: z.number().int(),
  /** Hours of the plan in force for the period (null: no plan applied). */
  plannedHours: z.number().int().nullable(),
});
export type LessonCountRowDto = z.infer<typeof LessonCountRowSchema>;

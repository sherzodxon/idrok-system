// M2 weekly timetable: versions and entries (docs/spec/lesson-plan.md §2, api-plan.md §3).
import { z } from "zod";
import { SchoolDateSchema } from "./common";

export const TimetableStatusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
export const WeekTypeSchema = z.enum(["ALL", "ODD", "EVEN"]);

export const TimetableSummarySchema = z.object({
  id: z.uuid(),
  academicYearId: z.uuid(),
  version: z.number().int(),
  status: TimetableStatusSchema,
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  note: z.string().nullable(),
  entryCount: z.number().int(),
  publishedAt: z.string().nullable(),
});
export type TimetableSummaryDto = z.infer<typeof TimetableSummarySchema>;

export const TimetableEntryInputSchema = z
  .object({
    teachingGroupId: z.uuid(),
    subjectId: z.uuid(),
    teacherId: z.uuid(),
    roomId: z.uuid().nullable().optional(),
    weekday: z.number().int().min(1).max(7),
    lessonNumber: z.number().int().min(0).max(20),
    weekType: WeekTypeSchema.default("ALL"),
  })
  .strict();
export type TimetableEntryInput = z.input<typeof TimetableEntryInputSchema>;

export const TimetableEntrySchema = z.object({
  id: z.uuid(),
  teachingGroupId: z.uuid(),
  teachingGroupName: z.string(),
  classGroupId: z.uuid().nullable(),
  subjectId: z.uuid(),
  subjectName: z.string(),
  teacherId: z.uuid(),
  teacherName: z.string(),
  roomId: z.uuid().nullable(),
  roomName: z.string().nullable(),
  weekday: z.number().int(),
  lessonNumber: z.number().int(),
  weekType: WeekTypeSchema,
});
export type TimetableEntryDto = z.infer<typeof TimetableEntrySchema>;

export const TimetableConflictKindSchema = z.enum(["TEACHER_BUSY", "GROUP_BUSY", "ROOM_BUSY", "CLASS_AND_SUBGROUP"]);
export const TimetableConflictSchema = z.object({
  kind: TimetableConflictKindSchema,
  weekday: z.number().int(),
  lessonNumber: z.number().int(),
  entryIds: z.array(z.uuid()),
});
export type TimetableConflictDto = z.infer<typeof TimetableConflictSchema>;

/** Non-blocking: the teacher has no current assignment for this group and subject. */
export const TimetableWarningSchema = z.object({ kind: z.literal("UNASSIGNED_TEACHER"), entryId: z.uuid() });

export const TimetableDetailSchema = TimetableSummarySchema.extend({
  entries: z.array(TimetableEntrySchema),
  conflicts: z.array(TimetableConflictSchema),
  warnings: z.array(TimetableWarningSchema),
});
export type TimetableDetailDto = z.infer<typeof TimetableDetailSchema>;

export const TimetableViewQuerySchema = z.object({
  view: z.enum(["class", "teacher", "room"]).optional(),
  id: z.uuid().optional(),
});

export const CreateTimetableSchema = z
  .object({ copyFromId: z.uuid().optional(), note: z.string().trim().max(200).optional() })
  .strict();

export const ReplaceTimetableEntriesSchema = z
  .object({ entries: z.array(TimetableEntryInputSchema).max(3000) })
  .strict();

export const PublishTimetableSchema = z.object({ validFrom: SchoolDateSchema }).strict();

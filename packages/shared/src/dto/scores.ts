// M3 scores, attendance, criteria, limits and the lesson journal (docs/spec/scoring.md §2, §3, §8).
import { z } from "zod";
import { DecimalStringSchema } from "./assessment";
import { SchoolDateSchema } from "./common";

/** Points as sent by a form: "5", "2.5" or a number; must be above zero. */
export const PointsSchema = z.coerce
  .string()
  .pipe(DecimalStringSchema)
  .refine((v) => Number(v) > 0, "validation.positive");

export const AttendanceStatusSchema = z.enum(["PRESENT", "LATE", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED"]);
export type AttendanceStatusCode = z.infer<typeof AttendanceStatusSchema>;

// ---- criteria

export const ScoreCriterionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  order: z.number().int(),
});
export type ScoreCriterionDto = z.infer<typeof ScoreCriterionSchema>;

export const UpsertScoreCriterionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
    order: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

// ---- settings

export const ScoreSettingsSchema = z.object({
  hardCapPerLesson: z.string(),
  hardCapPerDay: z.string(),
  lessonMaxPoints: z.string(),
  allowScoreOnAbsent: z.boolean(),
  lateEntryDays: z.number().int(),
});
export type ScoreSettingsDto = z.infer<typeof ScoreSettingsSchema>;

export const UpdateScoreSettingsSchema = z
  .object({
    hardCapPerLesson: PointsSchema,
    hardCapPerDay: PointsSchema,
    lessonMaxPoints: PointsSchema,
    allowScoreOnAbsent: z.boolean(),
    lateEntryDays: z.number().int().min(0).max(365),
  })
  .strict()
  .refine((v) => Number(v.lessonMaxPoints) <= Number(v.hardCapPerLesson), {
    message: "lesson_max_above_cap",
    path: ["lessonMaxPoints"],
  });

// ---- limit rules

export const LimitWindowSchema = z.enum(["LESSON", "DAY", "WEEK", "MONTH", "PERIOD"]);
export const LimitScopeSchema = z.enum(["GLOBAL", "SUBJECT", "GRADE", "TEACHER", "TEACHING_GROUP"]);

export const ScoreLimitRuleSchema = z.object({
  id: z.uuid(),
  window: LimitWindowSchema,
  scopeType: LimitScopeSchema,
  /** null = the default for the whole scope type. */
  scopeId: z.uuid().nullable(),
  scopeName: z.string().nullable(),
  maxPoints: z.string(),
  isActive: z.boolean(),
});
export type ScoreLimitRuleDto = z.infer<typeof ScoreLimitRuleSchema>;

export const CreateScoreLimitRuleSchema = z
  .object({
    window: LimitWindowSchema,
    scopeType: LimitScopeSchema,
    scopeId: z.uuid().nullable().default(null),
    maxPoints: PointsSchema,
  })
  .strict()
  .refine((v) => v.scopeType !== "GLOBAL" || v.scopeId === null, { message: "global_has_no_scope", path: ["scopeId"] });

export const UpdateScoreLimitRuleSchema = z.object({ maxPoints: PointsSchema, isActive: z.boolean() }).strict();

// ---- attendance and scores

export const SetAttendanceSchema = z
  .object({
    marks: z
      .array(
        z.object({
          studentId: z.uuid(),
          status: AttendanceStatusSchema,
          note: z.string().trim().max(300).nullable().optional(),
        }),
      )
      .min(1)
      .max(200),
  })
  .strict();

export const CreateScoreSchema = z
  .object({
    /** Client-made UUID: the same key again returns the first result (§3.1). */
    idempotencyKey: z.uuid(),
    lessonSessionId: z.uuid(),
    studentId: z.uuid(),
    criterionId: z.uuid().nullable().optional(),
    points: PointsSchema,
    note: z.string().trim().max(300).nullable().optional(),
    /** Required when the period is closed (assessment.reopen). */
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();
export type CreateScoreInput = z.infer<typeof CreateScoreSchema>;

/** One entry or a batch ("everyone N points"); each item stands alone — some may be refused. */
export const CreateScoresSchema = z.union([
  CreateScoreSchema,
  z.object({ entries: z.array(CreateScoreSchema).min(1).max(60) }).strict(),
]);

export const ReverseScoreSchema = z
  .object({ idempotencyKey: z.uuid(), reason: z.string().trim().min(3).max(500).optional() })
  .strict();

export const ScoreEntrySchema = z.object({
  id: z.uuid(),
  studentId: z.uuid(),
  lessonSessionId: z.uuid(),
  subjectId: z.uuid(),
  subjectName: z.string(),
  teacherId: z.uuid(),
  schoolDate: z.string(),
  criterionId: z.uuid().nullable(),
  criterionName: z.string().nullable(),
  topicTitle: z.string().nullable(),
  points: z.string(),
  kind: z.enum(["NORMAL", "REVERSAL"]),
  reversesEntryId: z.uuid().nullable(),
  reversed: z.boolean(),
  note: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type ScoreEntryDto = z.infer<typeof ScoreEntrySchema>;

export const ScoreResultSchema = z.union([
  z.object({ ok: z.literal(true), entry: ScoreEntrySchema }),
  z.object({
    ok: z.literal(false),
    idempotencyKey: z.uuid(),
    error: z.object({ code: z.string(), details: z.record(z.string(), z.unknown()).optional() }),
  }),
]);

export const ScoreQuerySchema = z.object({
  studentId: z.uuid(),
  subjectId: z.uuid().optional(),
  from: SchoolDateSchema,
  to: SchoolDateSchema,
});

// ---- journal of one lesson

export const JournalStudentSchema = z.object({
  studentId: z.uuid(),
  name: z.string(),
  attendance: AttendanceStatusSchema.nullable(),
  attendanceNote: z.string().nullable(),
  /** This teacher's lesson: the caller's view of the entries of this lesson (all teachers' for this lesson). */
  entries: z.array(ScoreEntrySchema),
  /** Net points in this lesson. */
  lessonPoints: z.string(),
  /** What still fits in this lesson / today (Q-43: a number, not who used the rest). */
  remainingLesson: z.string(),
  remainingToday: z.string(),
});

export const LessonJournalSchema = z.object({
  lessonSessionId: z.uuid(),
  date: z.string(),
  status: z.string(),
  subjectName: z.string(),
  teachingGroupName: z.string(),
  topicTitle: z.string().nullable(),
  maxPoints: z.string(),
  /** Why scores cannot be given now: null, or LESSON_CANCELLED / LESSON_IN_FUTURE / PERIOD_CLOSED / LATE_ENTRY. */
  locked: z.string().nullable(),
  criteria: z.array(ScoreCriterionSchema),
  students: z.array(JournalStudentSchema),
});
export type LessonJournalDto = z.infer<typeof LessonJournalSchema>;

// M2 calendar: periods, school week, calendar days, shifts, bell schedules, rooms (docs/spec/lesson-plan.md §2).
// Times of day travel as "HH:MM" in the school's time zone; the database stores minutes from midnight.
import { z } from "zod";
import { SchoolDateSchema } from "./common";

const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "invalid_time" });
const WeekdaySchema = z.number().int().min(1).max(7);
const NameSchema = z.string().trim().min(1).max(80);

// ---------------------------------------------------------------- periods

export const AcademicPeriodTypeSchema = z.enum(["QUARTER", "HALF", "YEAR", "CUSTOM"]);
export const AcademicPeriodStatusSchema = z.enum(["DRAFT", "ACTIVE", "CLOSED"]);

export const AcademicPeriodSchema = z.object({
  id: z.uuid(),
  academicYearId: z.uuid(),
  type: AcademicPeriodTypeSchema,
  name: z.string(),
  order: z.number().int(),
  startDate: z.string(),
  endDate: z.string(),
  parentId: z.uuid().nullable(),
  status: AcademicPeriodStatusSchema,
});
export type AcademicPeriodDto = z.infer<typeof AcademicPeriodSchema>;

export const CreateAcademicPeriodSchema = z
  .object({
    type: AcademicPeriodTypeSchema,
    name: NameSchema,
    order: z.number().int().min(1).max(20),
    startDate: SchoolDateSchema,
    endDate: SchoolDateSchema,
    parentId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => v.startDate <= v.endDate, { path: ["endDate"], message: "end_before_start" });

export const UpdateAcademicPeriodSchema = z
  .object({ name: NameSchema, startDate: SchoolDateSchema, endDate: SchoolDateSchema, parentId: z.uuid().nullable() })
  .partial()
  .strict();

// ---------------------------------------------------------------- school week

export const SchoolWeekSchema = z.object({
  academicYearId: z.uuid(),
  workingWeekdays: z.array(WeekdaySchema),
  /** false while the school has not saved its own week yet (the default is shown). */
  configured: z.boolean(),
});
export type SchoolWeekDto = z.infer<typeof SchoolWeekSchema>;

export const UpdateSchoolWeekSchema = z
  .object({
    workingWeekdays: z
      .array(WeekdaySchema)
      .min(1)
      .max(7)
      .refine((d) => new Set(d).size === d.length, { message: "duplicate" }),
  })
  .strict();

// ---------------------------------------------------------------- calendar days

export const CalendarDayKindSchema = z.enum(["HOLIDAY", "VACATION", "NON_WORKING", "WORKING_OVERRIDE", "SHORTENED"]);

export const CalendarDaySchema = z.object({
  id: z.uuid(),
  academicYearId: z.uuid(),
  date: z.string(),
  kind: CalendarDayKindSchema,
  title: z.string(),
  followsWeekday: WeekdaySchema.nullable(),
  appliesToAll: z.boolean(),
  gradeIds: z.array(z.uuid()),
});
export type CalendarDayDto = z.infer<typeof CalendarDaySchema>;

const calendarDayFields = {
  kind: CalendarDayKindSchema,
  title: NameSchema,
  followsWeekday: WeekdaySchema.nullable().optional(),
  /** Empty or missing: the whole school. */
  gradeIds: z.array(z.uuid()).max(12).optional(),
};
const overrideRule = (v: { kind?: string; followsWeekday?: number | null }) =>
  v.kind === undefined || (v.kind === "WORKING_OVERRIDE") === (v.followsWeekday != null);

export const CreateCalendarDaySchema = z
  .object({ date: SchoolDateSchema, ...calendarDayFields })
  .strict()
  .refine(overrideRule, { path: ["followsWeekday"], message: "follows_weekday_rule" });

/** Several days at once (a vacation week). */
export const CreateCalendarRangeSchema = z
  .object({ from: SchoolDateSchema, to: SchoolDateSchema, ...calendarDayFields })
  .strict()
  .refine((v) => v.from <= v.to, { path: ["to"], message: "end_before_start" })
  .refine(overrideRule, { path: ["followsWeekday"], message: "follows_weekday_rule" });

export const UpdateCalendarDaySchema = z
  .object(calendarDayFields)
  .partial()
  .strict()
  .refine(overrideRule, { path: ["followsWeekday"], message: "follows_weekday_rule" });

export const CalendarDayQuerySchema = z.object({ from: SchoolDateSchema.optional(), to: SchoolDateSchema.optional() });

// ---------------------------------------------------------------- shifts, rooms

export const ShiftSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  archived: z.boolean(),
});
export type ShiftDto = z.infer<typeof ShiftSchema>;

export const CreateShiftSchema = z
  .object({ name: NameSchema, startTime: TimeOfDaySchema, endTime: TimeOfDaySchema })
  .strict()
  .refine((v) => v.startTime < v.endTime, { path: ["endTime"], message: "end_before_start" });

export const UpdateShiftSchema = z
  .object({ name: NameSchema, startTime: TimeOfDaySchema, endTime: TimeOfDaySchema, archived: z.boolean() })
  .partial()
  .strict();

export const RoomSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  capacity: z.number().int().nullable(),
  archived: z.boolean(),
});
export type RoomDto = z.infer<typeof RoomSchema>;

export const CreateRoomSchema = z
  .object({ name: NameSchema, capacity: z.number().int().positive().max(500).nullable().optional() })
  .strict();

export const UpdateRoomSchema = z
  .object({ name: NameSchema, capacity: z.number().int().positive().max(500).nullable(), archived: z.boolean() })
  .partial()
  .strict();

// ---------------------------------------------------------------- bell schedules

export const BellSlotSchema = z.object({
  lessonNumber: z.number().int().min(0).max(20),
  startTime: TimeOfDaySchema,
  endTime: TimeOfDaySchema,
});

export const BellScheduleSchema = z.object({
  id: z.uuid(),
  academicYearId: z.uuid(),
  shiftId: z.uuid().nullable(),
  name: z.string(),
  validFrom: z.string(),
  slots: z.array(BellSlotSchema),
});
export type BellScheduleDto = z.infer<typeof BellScheduleSchema>;

const slotsSchema = z
  .array(BellSlotSchema)
  .min(1)
  .max(20)
  .superRefine((slots, ctx) => {
    const sorted = [...slots].sort((a, b) => a.lessonNumber - b.lessonNumber);
    sorted.forEach((s, i) => {
      if (s.startTime >= s.endTime)
        ctx.addIssue({ code: "custom", path: [slots.indexOf(s), "endTime"], message: "end_before_start" });
      const prev = sorted[i - 1];
      if (prev && prev.lessonNumber === s.lessonNumber)
        ctx.addIssue({ code: "custom", path: [slots.indexOf(s), "lessonNumber"], message: "duplicate" });
      else if (prev && prev.endTime > s.startTime)
        ctx.addIssue({ code: "custom", path: [slots.indexOf(s), "startTime"], message: "overlaps_previous" });
    });
  });

export const CreateBellScheduleSchema = z
  .object({
    name: NameSchema,
    shiftId: z.uuid().nullable().optional(),
    validFrom: SchoolDateSchema,
    slots: slotsSchema,
  })
  .strict();

export const UpdateBellScheduleSchema = z
  .object({ name: NameSchema, validFrom: SchoolDateSchema, slots: slotsSchema })
  .partial()
  .strict();

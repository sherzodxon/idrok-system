import { z } from "zod";
import { ListQuerySchema, SchoolDateSchema } from "./common";

export const AcademicYearStatusSchema = z.enum(["PLANNED", "ACTIVE", "CLOSED", "ARCHIVED"]);

export const AcademicYearSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: AcademicYearStatusSchema,
});
export type AcademicYearDto = z.infer<typeof AcademicYearSchema>;

export const CreateAcademicYearSchema = z
  .object({
    name: z.string().regex(/^\d{4}-\d{4}$/),
    startDate: SchoolDateSchema,
    endDate: SchoolDateSchema,
  })
  .strict()
  .refine((v) => v.startDate <= v.endDate, { path: ["endDate"], message: "end_before_start" });

export const UpdateAcademicYearSchema = z
  .object({ startDate: SchoolDateSchema, endDate: SchoolDateSchema })
  .partial()
  .strict();

export const GradeSchema = z.object({ id: z.uuid(), level: z.number().int(), name: z.string() });
export const CreateGradeSchema = z
  .object({ level: z.number().int().min(0).max(11), name: z.string().trim().min(1).max(40) })
  .strict();

export const ClassGroupSchema = z.object({
  id: z.uuid(),
  academicYearId: z.uuid(),
  gradeId: z.uuid(),
  gradeLevel: z.number().int(),
  section: z.string(),
  name: z.string(),
  homeroomTeacherId: z.uuid().nullable(),
  capacity: z.number().int().nullable(),
  shiftId: z.uuid().nullable(),
  studentCount: z.number().int(),
  classTeachingGroupId: z.uuid().nullable(),
});
export type ClassGroupDto = z.infer<typeof ClassGroupSchema>;

export const ClassGroupListQuerySchema = ListQuerySchema.extend({
  academicYearId: z.uuid().optional(),
  gradeId: z.uuid().optional(),
});

export const CreateClassGroupSchema = z
  .object({
    academicYearId: z.uuid(),
    gradeId: z.uuid(),
    section: z.string().trim().min(1).max(10),
    homeroomTeacherId: z.uuid().nullable().optional(),
    capacity: z.number().int().positive().max(60).nullable().optional(),
    shiftId: z.uuid().nullable().optional(),
  })
  .strict();

export const UpdateClassGroupSchema = z
  .object({
    homeroomTeacherId: z.uuid().nullable(),
    capacity: z.number().int().positive().max(60).nullable(),
    shiftId: z.uuid().nullable(),
  })
  .partial()
  .strict();

export const TeachingGroupSchema = z.object({
  id: z.uuid(),
  academicYearId: z.uuid(),
  classGroupId: z.uuid().nullable(),
  kind: z.enum(["CLASS", "SUBGROUP", "CROSS_CLASS"]),
  name: z.string(),
  subjectId: z.uuid().nullable(),
});
export type TeachingGroupDto = z.infer<typeof TeachingGroupSchema>;

export const CreateSubgroupSchema = z
  .object({ classGroupId: z.uuid(), subjectId: z.uuid().nullable().optional(), name: z.string().trim().min(1).max(80) })
  .strict();

export const UpdateMembersSchema = z
  .object({
    add: z
      .array(z.object({ studentId: z.uuid(), validFrom: SchoolDateSchema }))
      .max(100)
      .default([]),
    remove: z
      .array(z.object({ studentId: z.uuid(), validTo: SchoolDateSchema }))
      .max(100)
      .default([]),
  })
  .strict();

export const SubjectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  shortName: z.string().nullable(),
  code: z.string().nullable(),
  colorKey: z.string().nullable(),
  order: z.number().int(),
  archived: z.boolean(),
});
export const CreateSubjectSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    shortName: z.string().trim().max(20).nullable().optional(),
    code: z.string().trim().max(20).nullable().optional(),
    colorKey: z
      .string()
      .regex(/^chart-[1-8]$/)
      .nullable()
      .optional(),
    order: z.number().int().min(0).max(999).optional(),
  })
  .strict();
export const UpdateSubjectSchema = CreateSubjectSchema.partial().extend({ archived: z.boolean().optional() }).strict();

export const TeacherAssignmentSchema = z.object({
  id: z.uuid(),
  academicYearId: z.uuid(),
  teacherId: z.uuid(),
  teacherName: z.string(),
  teachingGroupId: z.uuid(),
  teachingGroupName: z.string(),
  subjectId: z.uuid(),
  subjectName: z.string(),
  weeklyHours: z.string().nullable(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
});
export type TeacherAssignmentDto = z.infer<typeof TeacherAssignmentSchema>;

export const TeacherAssignmentListQuerySchema = ListQuerySchema.extend({
  academicYearId: z.uuid().optional(),
  teacherId: z.uuid().optional(),
  teachingGroupId: z.uuid().optional(),
  subjectId: z.uuid().optional(),
  activeOn: SchoolDateSchema.optional(),
});

export const CreateTeacherAssignmentSchema = z
  .object({
    teacherId: z.uuid(),
    teachingGroupId: z.uuid(),
    subjectId: z.uuid(),
    weeklyHours: z.number().positive().max(40).nullable().optional(),
    validFrom: SchoolDateSchema,
  })
  .strict();

export const EndTeacherAssignmentSchema = z.object({ validTo: SchoolDateSchema }).strict();

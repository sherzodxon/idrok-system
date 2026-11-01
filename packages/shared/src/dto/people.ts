import { z } from "zod";
import { ListQuerySchema, PersonNameSchema, SchoolDateSchema } from "./common";

export const GenderSchema = z.enum(["MALE", "FEMALE"]);
export const StudentStatusSchema = z.enum(["ACTIVE", "GRADUATED", "LEFT", "SUSPENDED"]);
export const GuardianRelationSchema = z.enum(["MOTHER", "FATHER", "GRANDPARENT", "SIBLING", "OTHER"]);

const Phone = z.string().trim().min(5).max(30);

export const StudentListQuerySchema = ListQuerySchema.extend({
  classGroupId: z.uuid().optional(),
  status: StudentStatusSchema.optional(),
});

export const StudentSummarySchema = z.object({
  id: z.uuid(),
  studentCode: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  middleName: z.string().nullable(),
  status: StudentStatusSchema,
  classGroup: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  hasAccount: z.boolean(),
});
export type StudentSummary = z.infer<typeof StudentSummarySchema>;

export const GuardianLinkSchema = z.object({
  guardianId: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  relation: GuardianRelationSchema,
  isPrimary: z.boolean(),
  receivesNotifications: z.boolean(),
});

export const EnrollmentSchema = z.object({
  id: z.uuid(),
  academicYearId: z.uuid(),
  classGroupId: z.uuid(),
  classGroupName: z.string(),
  status: z.enum(["ACTIVE", "TRANSFERRED", "LEFT", "GRADUATED", "CANCELLED"]),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  reason: z.string().nullable(),
});

export const StudentDetailSchema = StudentSummarySchema.extend({
  dateOfBirth: z.string().nullable(),
  gender: GenderSchema.nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  guardians: z.array(GuardianLinkSchema),
  enrollments: z.array(EnrollmentSchema),
});
export type StudentDetail = z.infer<typeof StudentDetailSchema>;

export const CreateStudentSchema = z
  .object({
    firstName: PersonNameSchema,
    lastName: PersonNameSchema,
    middleName: PersonNameSchema.nullable().optional(),
    dateOfBirth: SchoolDateSchema.nullable().optional(),
    gender: GenderSchema.nullable().optional(),
    phone: Phone.nullable().optional(),
    address: z.string().trim().max(300).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    /** Optional placement right away. */
    enrollment: z.object({ classGroupId: z.uuid(), validFrom: SchoolDateSchema }).optional(),
  })
  .strict();

export const UpdateStudentSchema = CreateStudentSchema.omit({ enrollment: true }).partial().strict();

export const EnrollStudentSchema = z
  .object({ classGroupId: z.uuid(), validFrom: SchoolDateSchema, reason: z.string().trim().max(300).optional() })
  .strict();

export const ArchiveStudentSchema = z
  .object({
    status: z.enum(["LEFT", "GRADUATED"]),
    date: SchoolDateSchema,
    reason: z.string().trim().max(300).optional(),
  })
  .strict();

export const GuardianSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  middleName: z.string().nullable(),
  phone: z.string(),
  notes: z.string().nullable(),
  hasAccount: z.boolean(),
  children: z.array(
    z.object({ studentId: z.uuid(), firstName: z.string(), lastName: z.string(), relation: GuardianRelationSchema }),
  ),
});
export type GuardianDto = z.infer<typeof GuardianSchema>;

export const CreateGuardianSchema = z
  .object({
    firstName: PersonNameSchema,
    lastName: PersonNameSchema,
    middleName: PersonNameSchema.nullable().optional(),
    phone: Phone,
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();
export const UpdateGuardianSchema = CreateGuardianSchema.partial().strict();

export const LinkGuardianSchema = z
  .object({
    guardianId: z.uuid().optional(),
    newGuardian: CreateGuardianSchema.optional(),
    relation: GuardianRelationSchema,
    isPrimary: z.boolean().default(false),
    receivesNotifications: z.boolean().default(true),
  })
  .strict()
  .refine((v) => !!v.guardianId !== !!v.newGuardian, { message: "guardian_or_new_guardian" });

export const EmployeeStatusSchema = z.enum(["ACTIVE", "ON_LEAVE", "LEFT"]);
export const EmployeeSchema = z.object({
  id: z.uuid(),
  employeeCode: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  middleName: z.string().nullable(),
  phone: z.string().nullable(),
  positionTitle: z.string().nullable(),
  status: EmployeeStatusSchema,
  hasAccount: z.boolean(),
});
export type EmployeeDto = z.infer<typeof EmployeeSchema>;
export const CreateEmployeeSchema = z
  .object({
    firstName: PersonNameSchema,
    lastName: PersonNameSchema,
    middleName: PersonNameSchema.nullable().optional(),
    phone: Phone.nullable().optional(),
    positionTitle: z.string().trim().max(80).nullable().optional(),
    employeeCode: z.string().trim().max(30).nullable().optional(),
  })
  .strict();
export const UpdateEmployeeSchema = CreateEmployeeSchema.partial()
  .extend({ status: EmployeeStatusSchema.optional() })
  .strict();

export const CreateAccountSchema = z
  .object({
    /** Students below SchoolSettings.studentAccountMinGrade need an explicit confirmation (Q-27). */
    allowBelowMinGrade: z.boolean().optional(),
    roleIds: z.array(z.uuid()).max(10).optional(),
  })
  .strict();
export const AccountCreatedSchema = z.object({ userId: z.uuid(), username: z.string(), temporaryPassword: z.string() });

export const ImportKindSchema = z.enum(["STUDENTS_GUARDIANS", "EMPLOYEES_ASSIGNMENTS", "CLASS_GROUPS", "SUBJECTS"]);
export const ImportOptionsSchema = z
  .object({
    academicYearId: z.uuid().optional(),
    /** Enrollment / assignment start; defaults to the year start (or today if the year has started). */
    validFrom: SchoolDateSchema.optional(),
  })
  .strict();
/** Every kind a job can have: curriculum plans are uploaded through /curriculum-plans/import. */
export const ImportJobKindSchema = z.enum([...ImportKindSchema.options, "CURRICULUM_PLAN"]);
export const ImportJobSchema = z.object({
  id: z.uuid(),
  kind: ImportJobKindSchema,
  status: z.enum(["UPLOADED", "PARSING", "PREVIEW_READY", "COMMITTING", "COMMITTED", "FAILED", "CANCELLED"]),
  fileName: z.string(),
  summary: z.record(z.string(), z.number()).nullable(),
  errorCount: z.number().int(),
  warningCount: z.number().int(),
  failure: z.object({ code: z.string() }).nullable(),
  hasCredentials: z.boolean(),
  createdAt: z.string(),
  committedAt: z.string().nullable(),
});
export type ImportJobDto = z.infer<typeof ImportJobSchema>;
export const ImportMessageSchema = z.object({
  code: z.string(),
  field: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export const ImportRowSchema = z.object({
  rowNumber: z.number().int(),
  status: z.enum(["OK", "WARNING", "ERROR", "SKIPPED"]),
  data: z.record(z.string(), z.unknown()),
  messages: z.array(ImportMessageSchema),
});
export const ImportRowsQuerySchema = ListQuerySchema.extend({
  status: z.enum(["OK", "WARNING", "ERROR", "SKIPPED"]).optional(),
});
export const CommitImportSchema = z.object({ skipErrors: z.boolean().default(false) }).strict();

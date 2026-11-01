// Form schemas: flat fields with translation keys as messages (validation.<key>); the API validates again.
import { z } from "zod";
import { isSchoolDate } from "@idrok/shared/time";

const required = z.string().trim().min(1, "required").max(80, "too_long");
const optionalText = (max: number) => z.string().trim().max(max, "too_long").optional();
const date = z.string().refine((v) => isSchoolDate(v), "invalid_date");
const optionalDate = date.optional();

export const StudentFormSchema = z.object({
  lastName: required,
  firstName: required,
  middleName: optionalText(80),
  dateOfBirth: optionalDate,
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  phone: optionalText(30),
  address: optionalText(300),
  notes: optionalText(1000),
  classGroupId: z.string().optional(),
  validFrom: optionalDate,
});
export type StudentForm = z.infer<typeof StudentFormSchema>;

export const GuardianFormSchema = z.object({
  lastName: required,
  firstName: required,
  middleName: optionalText(80),
  phone: z.string().trim().min(5, "invalid_phone").max(30, "invalid_phone"),
  notes: optionalText(1000),
});
export type GuardianForm = z.infer<typeof GuardianFormSchema>;

export const EmployeeFormSchema = z.object({
  lastName: required,
  firstName: required,
  middleName: optionalText(80),
  phone: optionalText(30),
  positionTitle: optionalText(80),
  employeeCode: optionalText(30),
});
export type EmployeeForm = z.infer<typeof EmployeeFormSchema>;

/** Drops empty optional values so PATCH/POST bodies only carry what was filled in. */
export const compact = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;

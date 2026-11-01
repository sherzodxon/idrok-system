// Every model is in exactly one list; test/model-coverage.test.ts fails when a new model is not classified.

/** Models with a tenantId column: the tenant extension scopes every query on them. */
export const TENANT_SCOPED_MODELS = [
  "SchoolSettings",
  "SchoolBranding",
  "User",
  "AuthSession",
  "Role",
  "UserRole",
  "AuditLog",
  "FileAsset",
  "ImportJob",
  "IdempotencyRecord",
  "OutboxEvent",
  "AcademicYear",
  "Grade",
  "ClassGroup",
  "TeachingGroup",
  "TeachingGroupMember",
  "Subject",
  "Employee",
  "TeacherAssignment",
  "Student",
  "Guardian",
  "StudentGuardian",
  "StudentEnrollment",
  "AcademicPeriod",
  "SchoolWeek",
  "CalendarDay",
  "Shift",
  "BellSchedule",
  "Room",
] as const;

/** Child rows without tenantId: reached only through a tenant-checked parent (nested reads/writes). */
export const PARENT_SCOPED_MODELS = [
  "UserPreference",
  "RolePermission",
  "ImportRow",
  "CalendarDayGrade",
  "BellSlot",
] as const;

/** Not tenant data at all. */
export const GLOBAL_MODELS = ["Tenant", "Permission"] as const;

const scoped = new Set<string>(TENANT_SCOPED_MODELS);
export const isTenantScopedModel = (model: string): boolean => scoped.has(model);

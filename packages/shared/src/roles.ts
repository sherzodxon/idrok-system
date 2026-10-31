// System roles (Q-39). Default permission sets live in roleDefaults.ts once the RBAC matrix is approved.

export const SYSTEM_ROLES = [
  "SUPER_ADMIN",
  "SCHOOL_ADMIN",
  "DIRECTOR",
  "DEPUTY_DIRECTOR",
  "METHODIST",
  "TEACHER",
  "CLASS_TEACHER",
  "STUDENT",
  "GUARDIAN",
] as const;

export type SystemRoleCode = (typeof SYSTEM_ROLES)[number];

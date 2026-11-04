// Permission catalogue — the single source. The seed syncs the Permission table from this list; the web app uses the
// same codes to hide UI. Codes are added per stage (M2+ codes arrive with their modules).

export const PERMISSIONS = [
  // users and roles
  { code: "users.view", module: "users" },
  { code: "users.manage", module: "users" },
  { code: "roles.view", module: "roles" },
  { code: "roles.manage", module: "roles" },
  { code: "roles.assign", module: "roles" },
  // settings
  { code: "settings.view", module: "settings" },
  { code: "settings.manage", module: "settings" },
  { code: "branding.manage", module: "settings" },
  // school structure
  { code: "academic_years.view", module: "structure" },
  { code: "academic_years.manage", module: "structure" },
  { code: "class_groups.view", module: "structure" },
  { code: "class_groups.manage", module: "structure" },
  { code: "subjects.view", module: "structure" },
  { code: "subjects.manage", module: "structure" },
  { code: "teacher_assignments.view", module: "structure" },
  { code: "teacher_assignments.manage", module: "structure" },
  // people
  { code: "students.view", module: "people" },
  { code: "students.create", module: "people" },
  { code: "students.update", module: "people" },
  { code: "students.archive", module: "people" },
  { code: "guardians.view", module: "people" },
  { code: "guardians.manage", module: "people" },
  { code: "employees.view", module: "people" },
  { code: "employees.manage", module: "people" },
  // infrastructure
  { code: "imports.run", module: "infra" },
  { code: "exports.run", module: "infra" },
  { code: "audit_logs.view", module: "infra" },
  // calendar, timetable and lessons (M2)
  { code: "calendar.manage", module: "calendar" },
  { code: "timetable.view", module: "calendar" },
  { code: "timetable.manage", module: "calendar" },
  { code: "timetable.publish", module: "calendar" },
  { code: "lessons.view", module: "calendar" },
  { code: "lessons.mark", module: "calendar" },
  // curriculum plans (M2)
  { code: "curriculum.view", module: "curriculum" },
  { code: "curriculum.create", module: "curriculum" },
  { code: "curriculum.approve", module: "curriculum" },
  { code: "curriculum.export", module: "curriculum" },
  // scores and assessment (M3)
  { code: "scores.create", module: "assessment" },
  { code: "scores.correct", module: "assessment" },
  { code: "scores.late_entry", module: "assessment" },
  { code: "gradebook.view", module: "assessment" },
  { code: "assessment.view", module: "assessment" },
  { code: "assessment.manage", module: "assessment" },
  { code: "assessment.manual_entry", module: "assessment" },
  { code: "assessment.approve", module: "assessment" },
  { code: "assessment.reopen", module: "assessment" },
  // tests (M4)
  { code: "questions.manage", module: "tests" },
  { code: "questions.export", module: "tests" },
  { code: "tests.create", module: "tests" },
  { code: "tests.publish", module: "tests" },
  { code: "tests.reopen", module: "tests" },
  { code: "tests.results.view", module: "tests" },
  { code: "tests.results.enter", module: "tests" },
  { code: "test_types.manage", module: "tests" },
  // coins (M5)
  { code: "coins.view", module: "coins" },
  { code: "coins.give", module: "coins" },
  { code: "coins.adjust", module: "coins" },
  { code: "coins.reverse", module: "coins" },
  { code: "coins.settings.manage", module: "coins" },
  { code: "coins.criteria.manage", module: "coins" },
  { code: "coins.limits.manage", module: "coins" },
  { code: "coin_shop.manage", module: "coins" },
  { code: "coin_orders.process", module: "coins" },
  // school attendance and Face ID (M6)
  { code: "attendance.view", module: "attendance" },
  { code: "attendance.mark", module: "attendance" },
  { code: "attendance.settings.manage", module: "attendance" },
  { code: "devices.manage", module: "attendance" },
  { code: "face.manage", module: "attendance" },
  // self-service portals (data is always limited to the user's own child / own record)
  { code: "portal.student", module: "portal" },
  { code: "portal.guardian", module: "portal" },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]["code"];

export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSIONS.map((p) => p.code);

export function isPermissionCode(value: string): value is PermissionCode {
  return (PERMISSION_CODES as readonly string[]).includes(value);
}

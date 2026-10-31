// Data scope: which rows a caller may see, on top of the permission check (rbac-matrix.md "Ma'lumot doirasi").
// - school:   school-wide roles (admin, director, deputy, methodist) and any custom role made by the school;
// - teacher:  teaching groups of the caller's active assignments (+ homeroom classes for class teachers);
// - guardian: own children with canViewData; student: self.
import type { Db, Prisma } from "@idrok/db";
import { SYSTEM_ROLES, type SystemRoleCode } from "@idrok/shared";
import { schoolDateToDb, schoolToday, type SchoolDate } from "@idrok/shared/time";
import type { RequestAuth } from "../../http/auth";

const SCHOOL_WIDE: readonly SystemRoleCode[] = [
  "SUPER_ADMIN",
  "SCHOOL_ADMIN",
  "DIRECTOR",
  "DEPUTY_DIRECTOR",
  "METHODIST",
];

export type DataScope =
  | { kind: "school" }
  | { kind: "teacher"; employeeId: string; teachingGroupIds: string[]; homeroomClassIds: string[] }
  | { kind: "guardian"; guardianId: string }
  | { kind: "student"; studentId: string }
  | { kind: "none" };

const isSchoolWide = (roles: string[]) =>
  roles.some((r) => (SCHOOL_WIDE as readonly string[]).includes(r) || !(SYSTEM_ROLES as readonly string[]).includes(r));

export const activeOn = (day: SchoolDate) => {
  const d = schoolDateToDb(day);
  return { validFrom: { lte: d }, OR: [{ validTo: null }, { validTo: { gte: d } }] };
};

export async function resolveScope(db: Db, auth: RequestAuth, timezone: string): Promise<DataScope> {
  if (isSchoolWide(auth.roles)) return { kind: "school" };
  const user = await db.user.findUniqueOrThrow({
    where: { id: auth.userId },
    select: {
      employee: { select: { id: true } },
      guardian: { select: { id: true } },
      student: { select: { id: true } },
    },
  });
  if ((auth.roles.includes("TEACHER") || auth.roles.includes("CLASS_TEACHER")) && user.employee) {
    const today = schoolToday(timezone);
    const [assignments, homeroom] = await Promise.all([
      db.teacherAssignment.findMany({
        where: { teacherId: user.employee.id, ...activeOn(today) },
        select: { teachingGroupId: true },
      }),
      auth.roles.includes("CLASS_TEACHER")
        ? db.classGroup.findMany({
            where: { homeroomTeacherId: user.employee.id, archivedAt: null },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);
    return {
      kind: "teacher",
      employeeId: user.employee.id,
      teachingGroupIds: [...new Set(assignments.map((a) => a.teachingGroupId))],
      homeroomClassIds: homeroom.map((c) => c.id),
    };
  }
  if (auth.roles.includes("GUARDIAN") && user.guardian) return { kind: "guardian", guardianId: user.guardian.id };
  if (auth.roles.includes("STUDENT") && user.student) return { kind: "student", studentId: user.student.id };
  return { kind: "none" };
}

/** Students the scope may see (today's memberships for teachers). */
export function studentWhere(scope: DataScope, today: SchoolDate): Prisma.StudentWhereInput {
  switch (scope.kind) {
    case "school":
      return {};
    case "teacher":
      return {
        OR: [
          { groupMemberships: { some: { teachingGroupId: { in: scope.teachingGroupIds }, ...activeOn(today) } } },
          { enrollments: { some: { classGroupId: { in: scope.homeroomClassIds }, status: "ACTIVE" } } },
        ],
      };
    case "guardian":
      return { guardians: { some: { guardianId: scope.guardianId, revokedAt: null, canViewData: true } } };
    case "student":
      return { id: scope.studentId };
    case "none":
      return { id: { in: [] } };
  }
}

/** Classes the scope may see. */
export function classGroupWhere(scope: DataScope): Prisma.ClassGroupWhereInput {
  if (scope.kind === "school") return {};
  if (scope.kind === "teacher") {
    return {
      OR: [
        { id: { in: scope.homeroomClassIds } },
        { teachingGroups: { some: { id: { in: scope.teachingGroupIds } } } },
      ],
    };
  }
  return { id: { in: [] } };
}

/** Guardians the scope may see: everyone for school roles, guardians of homeroom students for class teachers. */
export function guardianWhere(scope: DataScope): Prisma.GuardianWhereInput {
  if (scope.kind === "school") return {};
  if (scope.kind === "teacher") {
    return {
      students: {
        some: {
          revokedAt: null,
          student: { enrollments: { some: { classGroupId: { in: scope.homeroomClassIds }, status: "ACTIVE" } } },
        },
      },
    };
  }
  if (scope.kind === "guardian") return { id: scope.guardianId };
  return { id: { in: [] } };
}

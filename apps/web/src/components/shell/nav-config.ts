import {
  BookOpen,
  FileSpreadsheet,
  LayoutDashboard,
  Settings,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { PermissionCode } from "@idrok/shared";

export type NavContext = "school" | "teacher";

export interface NavItem {
  key: "dashboard" | "students" | "guardians" | "employees" | "structure" | "imports" | "settings" | "myGroups";
  href: string;
  icon: LucideIcon;
  /** Hidden without it — the API checks again (CLAUDE.md §4). */
  permission?: PermissionCode;
}

export const NAV: Record<NavContext, NavItem[]> = {
  school: [
    { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
    { key: "students", href: "/admin/students", icon: Users, permission: "students.view" },
    { key: "guardians", href: "/admin/guardians", icon: UsersRound, permission: "guardians.view" },
    { key: "employees", href: "/admin/employees", icon: UserRound, permission: "employees.view" },
    { key: "structure", href: "/admin/structure", icon: BookOpen, permission: "class_groups.view" },
    { key: "imports", href: "/admin/imports", icon: FileSpreadsheet, permission: "imports.run" },
    { key: "settings", href: "/admin/settings", icon: Settings, permission: "settings.view" },
  ],
  teacher: [
    { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
    { key: "myGroups", href: "/teacher/groups", icon: BookOpen, permission: "class_groups.view" },
    { key: "students", href: "/teacher/students", icon: Users, permission: "students.view" },
  ],
};

const SCHOOL_ROLES = new Set(["SUPER_ADMIN", "SCHOOL_ADMIN", "DIRECTOR", "DEPUTY_DIRECTOR", "METHODIST"]);
const TEACHER_ROLES = new Set(["TEACHER", "CLASS_TEACHER"]);
const SYSTEM_ROLES = new Set([...SCHOOL_ROLES, ...TEACHER_ROLES, "STUDENT", "GUARDIAN"]);

/** Menu sets the user can switch between (custom school roles count as school management). */
export function availableContexts(roles: string[]): NavContext[] {
  const out: NavContext[] = [];
  if (roles.some((r) => SCHOOL_ROLES.has(r) || !SYSTEM_ROLES.has(r))) out.push("school");
  if (roles.some((r) => TEACHER_ROLES.has(r))) out.push("teacher");
  return out.length ? out : ["school"];
}

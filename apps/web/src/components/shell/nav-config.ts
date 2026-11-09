import {
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  CalendarRange,
  ClipboardList,
  Clock,
  Coins,
  DoorOpen,
  FileQuestion,
  FileBarChart,
  FileSpreadsheet,
  Gift,
  GraduationCap,
  Gauge,
  LayoutDashboard,
  NotebookText,
  Settings,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { PermissionCode } from "@idrok/shared";

export type NavContext = "school" | "teacher";

/** Sidebar sections (audit 2026-11-05): headings are `nav.groups.<key>`. */
export type NavGroupKey =
  "main" | "people" | "teaching" | "assessment" | "attendance" | "rewards" | "system" | "today" | "lesson" | "prep";

export interface NavItem {
  key:
    | "dashboard"
    | "students"
    | "guardians"
    | "employees"
    | "structure"
    | "calendar"
    | "timetable"
    | "plans"
    | "myPlans"
    | "lessons"
    | "mySchedule"
    | "imports"
    | "settings"
    | "myGroups"
    | "gradebook"
    | "assessment"
    | "tests"
    | "questions"
    | "coins"
    | "coinShop"
    | "attendance"
    | "reports";
  href: string;
  icon: LucideIcon;
  group: NavGroupKey;
  /** Hidden without it — the API checks again (CLAUDE.md §4). */
  permission?: PermissionCode;
  /** Shown with any of these (a page whose parts need different permissions). */
  anyOf?: PermissionCode[];
}

export const NAV: Record<NavContext, NavItem[]> = {
  school: [
    { key: "dashboard", href: "/dashboard", icon: LayoutDashboard, group: "main" },
    {
      key: "reports",
      href: "/admin/reports",
      icon: FileBarChart,
      group: "main",
      anyOf: ["attendance.view", "employees.view", "assessment.view", "coins.view"],
    },
    { key: "students", href: "/admin/students", icon: Users, group: "people", permission: "students.view" },
    { key: "guardians", href: "/admin/guardians", icon: UsersRound, group: "people", permission: "guardians.view" },
    { key: "employees", href: "/admin/employees", icon: UserRound, group: "people", permission: "employees.view" },
    { key: "structure", href: "/admin/structure", icon: BookOpen, group: "teaching", permission: "class_groups.view" },
    { key: "calendar", href: "/admin/calendar", icon: CalendarDays, group: "teaching", permission: "calendar.manage" },
    {
      key: "timetable",
      href: "/admin/timetable",
      icon: CalendarRange,
      group: "teaching",
      permission: "timetable.manage",
    },
    { key: "lessons", href: "/admin/lessons", icon: ClipboardList, group: "teaching", permission: "timetable.manage" },
    { key: "plans", href: "/admin/plans", icon: NotebookText, group: "teaching", permission: "curriculum.approve" },
    {
      key: "gradebook",
      href: "/admin/gradebook",
      icon: GraduationCap,
      group: "assessment",
      permission: "gradebook.view",
    },
    { key: "assessment", href: "/admin/assessment", icon: Gauge, group: "assessment", permission: "assessment.view" },
    { key: "tests", href: "/admin/tests", icon: ClipboardCheck, group: "assessment", permission: "tests.results.view" },
    {
      key: "attendance",
      href: "/admin/attendance",
      icon: DoorOpen,
      group: "attendance",
      permission: "attendance.view",
    },
    { key: "coins", href: "/admin/coins", icon: Coins, group: "rewards", permission: "coins.view" },
    { key: "coinShop", href: "/admin/shop", icon: Gift, group: "rewards", permission: "coin_orders.process" },
    { key: "imports", href: "/admin/imports", icon: FileSpreadsheet, group: "system", permission: "imports.run" },
    { key: "settings", href: "/admin/settings", icon: Settings, group: "system", permission: "settings.view" },
  ],
  teacher: [
    { key: "dashboard", href: "/dashboard", icon: LayoutDashboard, group: "today" },
    { key: "mySchedule", href: "/teacher/schedule", icon: Clock, group: "today", permission: "lessons.view" },
    {
      key: "gradebook",
      href: "/teacher/gradebook",
      icon: GraduationCap,
      group: "lesson",
      permission: "gradebook.view",
    },
    { key: "attendance", href: "/teacher/attendance", icon: DoorOpen, group: "lesson", permission: "attendance.view" },
    { key: "coins", href: "/teacher/coins", icon: Coins, group: "lesson", permission: "coins.give" },
    { key: "myPlans", href: "/teacher/plans", icon: NotebookText, group: "prep", permission: "curriculum.create" },
    { key: "tests", href: "/teacher/tests", icon: ClipboardCheck, group: "prep", permission: "tests.create" },
    { key: "questions", href: "/teacher/questions", icon: FileQuestion, group: "prep", permission: "questions.manage" },
    { key: "myGroups", href: "/teacher/groups", icon: BookOpen, group: "people", permission: "class_groups.view" },
    { key: "students", href: "/teacher/students", icon: Users, group: "people", permission: "students.view" },
  ],
};

/** Consecutive items of one group form a section; the order of NAV decides the order of sections. */
export function groupNav<T extends { group: NavGroupKey }>(items: T[]): { group: NavGroupKey; items: T[] }[] {
  const out: { group: NavGroupKey; items: T[] }[] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (last?.group === item.group) last.items.push(item);
    else out.push({ group: item.group, items: [item] });
  }
  return out;
}

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

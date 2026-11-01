"use client";

// Shared reference data for forms and filters (cached by TanStack Query).
import { useQuery } from "@tanstack/react-query";
import type { AcademicYearDto, ClassGroupDto, EmployeeDto, Page, RoleDto, TeachingGroupDto } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";

export function useYears() {
  const api = useApi();
  return useQuery({ queryKey: ["academic-years"], queryFn: () => api.get<AcademicYearDto[]>("/academic-years") });
}

export function useActiveYear() {
  const years = useYears();
  return { ...years, data: years.data?.find((y) => y.status === "ACTIVE") ?? years.data?.[0] };
}

export function useClassGroups(yearId?: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["class-groups", yearId ?? "all"],
    queryFn: () =>
      api
        .get<Page<ClassGroupDto>>(`/class-groups?pageSize=100${yearId ? `&academicYearId=${yearId}` : ""}`)
        .then((p) => p.items),
  });
}

export function useGrades() {
  const api = useApi();
  return useQuery({
    queryKey: ["grades"],
    queryFn: () => api.get<{ id: string; level: number; name: string }[]>("/grades"),
  });
}

export function useSubjects(includeArchived = false) {
  const api = useApi();
  return useQuery({
    queryKey: ["subjects", includeArchived],
    queryFn: () =>
      api.get<
        { id: string; name: string; shortName: string | null; code: string | null; archived: boolean; order: number }[]
      >(`/subjects${includeArchived ? "?includeArchived=true" : ""}`),
  });
}

export function useEmployees(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api.get<Page<EmployeeDto>>("/employees?pageSize=100&status=ACTIVE").then((p) => p.items),
    enabled,
  });
}

export function useTeachingGroups(classGroupId?: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["teaching-groups", classGroupId ?? "all"],
    queryFn: () =>
      api.get<TeachingGroupDto[]>(`/teaching-groups${classGroupId ? `?classGroupId=${classGroupId}` : ""}`),
  });
}

export function useRoles(enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: ["roles"], queryFn: () => api.get<RoleDto[]>("/roles"), enabled });
}

export const personName = (p: { lastName: string; firstName: string; middleName?: string | null }) =>
  [p.lastName, p.firstName, p.middleName].filter(Boolean).join(" ");

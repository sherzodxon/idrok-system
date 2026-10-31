"use client";

import { useQuery } from "@tanstack/react-query";
import { BookOpen, UserRound, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Page } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { useShellBranding } from "@/components/shell/branding-context";
import { KpiHeroCard, StatCard } from "@/components/ui/stats";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { can, useMe } from "@/lib/use-me";

const SCHOOL_ROLES = ["SUPER_ADMIN", "SCHOOL_ADMIN", "DIRECTOR", "DEPUTY_DIRECTOR", "METHODIST"];

/** Total of a list endpoint (pageSize=1); the API applies the caller's data scope. */
function useTotal(path: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ["total", path],
    queryFn: () => api.get<Page<unknown>>(`${path}?pageSize=1`).then((p) => p.total),
    enabled,
  });
}

export function Dashboard() {
  const t = useTranslations("dashboard");
  const me = useMe();
  const branding = useShellBranding();
  const data = me.data;
  const school = !!data && data.roles.some((r) => SCHOOL_ROLES.includes(r));
  const students = useTotal("/students", can(data, "students.view"));
  const employees = useTotal("/employees", school && can(data, "employees.view"));
  const classes = useTotal("/class-groups", can(data, "class_groups.view"));

  if (me.isPending) return <LoadingState />;
  if (!data) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  const firstError = [students, employees, classes].find((q) => q.isError);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="dashboard-title">
          {t("welcome", { name: data.displayName })}
        </h1>
        <p className="text-sm text-muted">{t("subtitle", { school: branding.schoolName })}</p>
      </div>
      {firstError ? (
        <ErrorState
          error={firstError.error}
          onRetry={() => [students, employees, classes].forEach((q) => void q.refetch())}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {can(data, "students.view") && (
            <KpiHeroCard
              label={school ? t("students") : t("myStudents")}
              value={students.data ?? 0}
              loading={students.isPending}
            />
          )}
          {school && can(data, "employees.view") && (
            <StatCard
              label={t("employees")}
              value={employees.data ?? 0}
              loading={employees.isPending}
              icon={<UserRound className="size-5" aria-hidden />}
            />
          )}
          {can(data, "class_groups.view") && (
            <StatCard
              label={school ? t("classes") : t("myClasses")}
              value={classes.data ?? 0}
              loading={classes.isPending}
              icon={<BookOpen className="size-5" aria-hidden />}
            />
          )}
          {!school && !can(data, "students.view") && (
            <StatCard label={t("students")} value="—" icon={<Users className="size-5" aria-hidden />} />
          )}
        </div>
      )}
    </div>
  );
}

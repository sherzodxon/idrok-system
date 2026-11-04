"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, GraduationCap } from "lucide-react";
import { useTranslations } from "next-intl";
import type { StudentSummary } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState, QueryBoundary } from "@/components/ui/states";
import { HomeAttendanceCard } from "@/components/attendance/pages";
import { can, useMe } from "@/lib/use-me";

export function PortalHome() {
  const t = useTranslations("dashboard");
  const api = useApi();
  const me = useMe();
  const isGuardian = can(me.data, "portal.guardian");
  const children = useQuery({
    queryKey: ["children"],
    queryFn: () => api.get<StudentSummary[]>("/me/children"),
    enabled: isGuardian,
  });

  if (me.isPending) return <LoadingState />;
  if (!me.data) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-foreground" data-testid="portal-title">
        {t("welcome", { name: me.data.displayName })}
      </h1>
      {isGuardian ? (
        <Card>
          <CardHeader title={t("children")} />
          <QueryBoundary
            query={children}
            isEmpty={(list) => list.length === 0}
            empty={<EmptyState text={t("noChildren")} />}
          >
            {(list) => (
              <ul className="divide-y divide-border" data-testid="children">
                {list.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-4">
                    <Avatar name={`${c.firstName} ${c.lastName}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{`${c.lastName} ${c.firstName}`}</p>
                      {c.classGroup && (
                        <p className="text-sm text-muted">{t("classLabel", { name: c.classGroup.name })}</p>
                      )}
                    </div>
                    <ChevronRight className="size-5 text-muted" aria-hidden />
                  </li>
                ))}
              </ul>
            )}
          </QueryBoundary>
        </Card>
      ) : (
        <Card>
          <EmptyState icon={<GraduationCap className="size-6" aria-hidden />} text={t("studentHome")} />
        </Card>
      )}
      <HomeAttendanceCard />
    </div>
  );
}

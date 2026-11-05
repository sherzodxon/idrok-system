"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { CoinSummaryDto, PortalWeekDto, StudentProgressDto, StudentSummary, StudentTestDto } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { formatTime } from "@/components/attendance/common";
import { HomeAttendanceCard } from "@/components/attendance/pages";
import { useCoinStatus } from "@/components/coins/common";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, LoadingState, QueryBoundary } from "@/components/ui/states";
import { can, useMe } from "@/lib/use-me";

const OPEN_STATES = new Set(["AVAILABLE", "IN_PROGRESS", "UPCOMING"]);
const TEST_TONE = { AVAILABLE: "success", IN_PROGRESS: "primary", UPCOMING: "warning" } as const;

/** Coin balance and the period result, side by side on a phone. */
function StudentTiles({ studentId }: { studentId: string }) {
  const t = useTranslations("dashboard.student");
  const api = useApi();
  const coinStatus = useCoinStatus();
  const coins = useQuery({
    queryKey: ["coin-summary", studentId],
    queryFn: () => api.get<CoinSummaryDto>(`/coins/students/${studentId}/summary`),
    enabled: !!coinStatus.data?.isEnabled,
  });
  const progress = useQuery({
    queryKey: ["progress", studentId, "PERIOD"],
    queryFn: () => api.get<StudentProgressDto>(`/students/${studentId}/progress?view=PERIOD`),
  });
  const tile = (href: string, label: string, value: string, loading: boolean, testId: string) => (
    <Link
      href={href}
      data-testid={testId}
      className="flex flex-col gap-1 rounded-card bg-linear-135 from-brand to-brand-deep p-4 text-on-brand shadow-card"
    >
      <span className="text-sm opacity-90">{label}</span>
      {loading ? (
        <Skeleton className="h-8 w-16 opacity-40" />
      ) : (
        <span className="tabular text-2xl font-bold">{value}</span>
      )}
    </Link>
  );
  const percent = progress.data?.overall?.displayPercent ?? null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {coinStatus.data?.isEnabled &&
        tile(
          "/coins",
          t("coins"),
          coins.isError ? "—" : String(coins.data?.balance ?? 0),
          coins.isPending,
          "home-coins",
        )}
      {tile(
        "/progress",
        progress.data?.periodName ?? t("result"),
        progress.isError || percent === null ? "—" : `${percent}%`,
        progress.isPending,
        "home-progress",
      )}
    </div>
  );
}

function TodayLessons() {
  const t = useTranslations("dashboard.student");
  const api = useApi();
  const locale = useLocale();
  const week = useQuery({ queryKey: ["portal-week", "home"], queryFn: () => api.get<PortalWeekDto>("/me/timetable") });
  return (
    <Card>
      <CardHeader
        title={t("today")}
        action={
          <Link href="/schedule" className="text-sm font-medium text-primary hover:underline">
            {t("week")}
          </Link>
        }
      />
      <QueryBoundary
        query={week}
        isEmpty={(w) => !w.lessons.some((l) => l.date === w.today)}
        empty={<EmptyState text={t("noLessons")} />}
      >
        {(w) => (
          <ul className="divide-y divide-border px-5 pb-2" data-testid="home-lessons">
            {w.lessons
              .filter((l) => l.date === w.today)
              .map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-3">
                  <span className="tabular w-12 shrink-0 text-sm text-muted">{formatTime(l.startsAt, locale)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.subjectName}</span>
                    <span className="block truncate text-sm text-muted">{l.topicTitle ?? l.teacherName}</span>
                  </span>
                  {l.status === "CANCELLED" && <Badge tone="danger">{t("cancelled")}</Badge>}
                </li>
              ))}
          </ul>
        )}
      </QueryBoundary>
    </Card>
  );
}

function OpenTests() {
  const t = useTranslations("dashboard.student");
  const tt = useTranslations("tests");
  const api = useApi();
  const tests = useQuery({ queryKey: ["my-tests"], queryFn: () => api.get<StudentTestDto[]>("/me/tests") });
  return (
    <Card>
      <CardHeader
        title={t("tests")}
        action={
          <Link href="/tests" className="text-sm font-medium text-primary hover:underline">
            {t("allTests")}
          </Link>
        }
      />
      <QueryBoundary
        query={tests}
        isEmpty={(l) => !l.some((x) => OPEN_STATES.has(x.state))}
        empty={<EmptyState text={t("noTests")} />}
      >
        {(list) => (
          <ul className="divide-y divide-border px-5 pb-2" data-testid="home-tests">
            {list
              .filter((x) => OPEN_STATES.has(x.state))
              .slice(0, 3)
              .map((x) => (
                <li key={x.id}>
                  <Link href="/tests" className="flex items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{x.title}</span>
                      <span className="block truncate text-sm text-muted">{x.subjectName}</span>
                    </span>
                    <Badge tone={TEST_TONE[x.state as keyof typeof TEST_TONE]}>{tt(`portal.states.${x.state}`)}</Badge>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </QueryBoundary>
    </Card>
  );
}

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
        me.data.profiles.studentId && (
          <>
            <StudentTiles studentId={me.data.profiles.studentId} />
            <TodayLessons />
          </>
        )
      )}
      <HomeAttendanceCard />
      {!isGuardian && me.data.profiles.studentId && <OpenTests />}
    </div>
  );
}

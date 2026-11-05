"use client";

// Role dashboards (audit phase 3). Every number comes from the API (attendance summary, missing-scores report, coin
// overview, the teacher's day); this file only lays them out. Each widget shows only with its permission.
import { useQuery } from "@tanstack/react-query";
import { BookOpen, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { AttendanceSummaryDto, CoinOverviewDto, Me, MissingScoresRowDto, Page } from "@idrok/shared";
import { addSchoolDays, schoolToday } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { useShellBranding } from "@/components/shell/branding-context";
import { useAttendanceFeature } from "@/components/attendance/common";
import { TodayLessonsCard, useTeacherDay } from "@/components/lessons/lessons-pages";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { BarList, TrendChart } from "@/components/ui/charts";
import { KpiHeroCard, StatCard } from "@/components/ui/stats";
import { EmptyState, ErrorState, LoadingState, QueryBoundary } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { can, useMe } from "@/lib/use-me";

const SCHOOL_ROLES = ["SUPER_ADMIN", "SCHOOL_ADMIN", "DIRECTOR", "DEPUTY_DIRECTOR", "METHODIST"];
const WEEK_BACK = -6;

/** Total of a list endpoint (pageSize=1); the API applies the caller's data scope. */
function useTotal(path: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ["total", path],
    queryFn: () => api.get<Page<unknown>>(`${path}?pageSize=1`).then((p) => p.total),
    enabled,
  });
}

function usePercent() {
  const locale = useLocale() === "ru" ? "ru-RU" : "uz-UZ";
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return {
    /** API percents are decimal strings ("94.2"); converted only for display. */
    rate: (v: string | null) => (v === null ? "—" : `${nf.format(Number(v))}%`),
    axis: (v: number) => `${whole.format(v)}%`,
  };
}

const arrived = (counts: Record<string, number>) => (counts.PRESENT ?? 0) + (counts.LATE ?? 0);
/** "2026-11-05" → "5.11" for chart labels (string only, no date arithmetic). */
const shortDate = (d: string) => `${Number(d.slice(8, 10))}.${d.slice(5, 7)}`;

function useSchoolData(me: Me) {
  const api = useApi();
  const feature = useAttendanceFeature();
  const today = schoolToday();
  const from = addSchoolDays(today, WEEK_BACK);
  const attendance = useQuery({
    queryKey: ["attendance-summary", 14],
    queryFn: () => api.get<AttendanceSummaryDto>("/attendance/summary?days=14"),
    enabled: can(me, "attendance.view") && !!feature.data?.isEnabled,
    refetchInterval: 60_000,
  });
  const missing = useQuery({
    queryKey: ["missing-scores", from, today],
    queryFn: () => api.get<MissingScoresRowDto[]>(`/reports/missing-scores?from=${from}&to=${today}`),
    enabled: can(me, "assessment.view"),
  });
  const coins = useQuery({
    queryKey: ["coins-overview", from, today],
    queryFn: () => api.get<CoinOverviewDto>(`/coins/overview?from=${from}&to=${today}`),
    enabled: can(me, "coins.view"),
  });
  return { attendance, missing, coins, attendanceOn: can(me, "attendance.view") && !!feature.data?.isEnabled };
}

function SchoolOverview({ me }: { me: Me }) {
  const t = useTranslations("dashboard");
  const pct = usePercent();
  const { attendance, missing, coins, attendanceOn } = useSchoolData(me);
  const today = attendance.data?.today;
  const unscored = missing.data?.reduce((n, r) => n + r.unscored, 0) ?? 0;
  const lagging = missing.data?.filter((r) => r.unscored > 0) ?? [];
  const failed = t("loadFailed");

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" data-testid="school-kpis">
        {attendanceOn && (
          <>
            <KpiHeroCard
              label={t("presentToday")}
              value={attendance.isError ? "—" : pct.rate(today?.rate ?? null)}
              hint={
                attendance.isError
                  ? failed
                  : today
                    ? t("arrivedOf", { arrived: arrived(today.counts), expected: today.expected })
                    : undefined
              }
              loading={attendance.isPending}
            />
            <StatCard
              label={t("lateToday")}
              value={attendance.isError ? "—" : (today?.counts.LATE ?? 0)}
              hint={attendance.isError ? failed : t("absentToday", { n: today?.counts.ABSENT ?? 0 })}
              loading={attendance.isPending}
            />
          </>
        )}
        {can(me, "assessment.view") && (
          <StatCard
            label={t("unscoredLessons")}
            value={missing.isError ? "—" : unscored}
            hint={missing.isError ? failed : t("unscoredTeachers", { n: lagging.length })}
            delta={
              !missing.isError && unscored === 0 && !missing.isPending
                ? { text: t("allScored"), tone: "good" }
                : undefined
            }
            loading={missing.isPending}
          />
        )}
        {can(me, "coins.view") && (
          <StatCard
            label={t("coinsWeek")}
            value={coins.isError ? "—" : coins.data ? coins.data.awarded + coins.data.automatic : 0}
            hint={coins.isError ? failed : t("pendingOrders", { n: coins.data?.pendingOrders ?? 0 })}
            loading={coins.isPending}
          />
        )}
      </div>

      {(attendanceOn || can(me, "assessment.view")) && (
        <div className="grid gap-4 lg:grid-cols-3">
          {attendanceOn && (
            <Card className="min-w-0 lg:col-span-2">
              <CardHeader title={t("trendTitle")} />
              <div className="p-5 pt-3">
                <QueryBoundary
                  query={attendance}
                  loading={<Skeleton className="h-44 w-full" />}
                  isEmpty={(d) => d.trend.length === 0}
                  empty={<EmptyState text={t("trendEmpty")} />}
                >
                  {(d) => (
                    <TrendChart
                      label={t("trendTitle")}
                      points={d.trend.map((p, i) => ({
                        value: p.rate === null ? null : Number(p.rate),
                        label: i % 3 === 0 || i === d.trend.length - 1 ? shortDate(p.date) : "",
                      }))}
                      ceil={100}
                      format={pct.axis}
                    />
                  )}
                </QueryBoundary>
              </div>
            </Card>
          )}
          {can(me, "assessment.view") && (
            <Card className="min-w-0">
              <CardHeader title={t("attention")} />
              <QueryBoundary
                query={missing}
                isEmpty={(rows) => rows.every((r) => r.unscored === 0)}
                empty={<EmptyState text={t("attentionEmpty")} />}
              >
                {(rows) => (
                  <ul className="divide-y divide-border px-5 pb-3" data-testid="unscored-teachers">
                    {rows
                      .filter((r) => r.unscored > 0)
                      .slice(0, 6)
                      .map((r) => (
                        <li key={r.teacherId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                          <span className="min-w-0 truncate">{r.teacherName}</span>
                          <Badge tone="warning">{t("lessonsN", { n: r.unscored })}</Badge>
                        </li>
                      ))}
                  </ul>
                )}
              </QueryBoundary>
              <Link
                href="/admin/gradebook"
                className="block border-t border-border px-5 py-3 text-sm font-medium text-primary hover:underline"
              >
                {t("openGradebook")}
              </Link>
            </Card>
          )}
          {attendanceOn && (
            <Card className="min-w-0 lg:col-span-3">
              <CardHeader title={t("byClass")} />
              <div className="p-5 pt-3">
                <QueryBoundary
                  query={attendance}
                  isEmpty={(d) => d.today.byClass.every((c) => c.rate === null)}
                  empty={<EmptyState text={t("byClassEmpty")} />}
                >
                  {(d) => (
                    <BarList
                      max={100}
                      format={(v) => pct.rate(String(v))}
                      items={d.today.byClass
                        .filter((c) => c.rate !== null)
                        .map((c) => ({ key: c.classGroupId, label: c.className, value: Number(c.rate) }))}
                    />
                  )}
                </QueryBoundary>
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

/** A class teacher's own class today (the API scopes attendance to their homeroom classes). */
function HomeroomTile() {
  const t = useTranslations("dashboard");
  const api = useApi();
  const pct = usePercent();
  const summary = useQuery({
    queryKey: ["attendance-summary", 1],
    queryFn: () => api.get<AttendanceSummaryDto>("/attendance/summary?days=1"),
    refetchInterval: 60_000,
  });
  const today = summary.data?.today;
  return (
    <StatCard
      label={t("myClassToday")}
      value={summary.isError ? "—" : pct.rate(today?.rate ?? null)}
      hint={
        summary.isError
          ? t("loadFailed")
          : today
            ? t("arrivedOf", { arrived: arrived(today.counts), expected: today.expected })
            : undefined
      }
      loading={summary.isPending}
    />
  );
}

function TeacherOverview({ homeroom }: { homeroom: boolean }) {
  const t = useTranslations("dashboard");
  const day = useTeacherDay();
  const lessons = day.data?.lessons ?? [];
  const started = lessons.filter((l) => l.started && l.status !== "CANCELLED");
  const scored = started.filter((l) => l.scoredStudents > 0).length;
  if (day.isError) return <ErrorState error={day.error} onRetry={() => void day.refetch()} />;
  return (
    <div
      className={
        homeroom ? "grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" : "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4"
      }
      data-testid="teacher-kpis"
    >
      <KpiHeroCard
        label={t("myLessonsToday")}
        value={lessons.length}
        hint={t("startedN", { n: started.length })}
        loading={day.isPending}
      />
      <StatCard
        label={t("scoredToday")}
        value={`${scored} / ${started.length}`}
        delta={
          started.length > 0 && scored < started.length
            ? { text: t("scoreLeft", { n: started.length - scored }), tone: "bad" }
            : undefined
        }
        loading={day.isPending}
      />
      <StatCard
        label={t("unscoredRecent")}
        value={day.data?.unscoredRecent ?? 0}
        delta={day.data && day.data.unscoredRecent === 0 ? { text: t("allScored"), tone: "good" } : undefined}
        hint={t("last7days")}
        loading={day.isPending}
      />
      {homeroom && <HomeroomTile />}
    </div>
  );
}

function Counts({ me, school }: { me: Me; school: boolean }) {
  const t = useTranslations("dashboard");
  const students = useTotal("/students", can(me, "students.view"));
  const employees = useTotal("/employees", school && can(me, "employees.view"));
  const classes = useTotal("/class-groups", can(me, "class_groups.view"));
  const firstError = [students, employees, classes].find((q) => q.isError);
  if (firstError)
    return (
      <ErrorState
        error={firstError.error}
        onRetry={() => [students, employees, classes].forEach((q) => void q.refetch())}
      />
    );
  return (
    <div className="grid gap-4 sm:grid-cols-3" data-testid="school-counts">
      {can(me, "students.view") && (
        <StatCard
          label={school ? t("students") : t("myStudents")}
          value={students.data ?? 0}
          loading={students.isPending}
          icon={<Users className="size-5" aria-hidden />}
        />
      )}
      {school && can(me, "employees.view") && (
        <StatCard
          label={t("employees")}
          value={employees.data ?? 0}
          loading={employees.isPending}
          icon={<UserRound className="size-5" aria-hidden />}
        />
      )}
      {can(me, "class_groups.view") && (
        <StatCard
          label={school ? t("classes") : t("myClasses")}
          value={classes.data ?? 0}
          loading={classes.isPending}
          icon={<BookOpen className="size-5" aria-hidden />}
        />
      )}
    </div>
  );
}

export function Dashboard() {
  const t = useTranslations("dashboard");
  const me = useMe();
  const branding = useShellBranding();
  const feature = useAttendanceFeature();
  const data = me.data;
  if (me.isPending) return <LoadingState />;
  if (!data) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  const school = data.roles.some((r) => SCHOOL_ROLES.includes(r));
  const teaches = !!data.profiles.employeeId && can(data, "lessons.view");
  const homeroom = !school && can(data, "attendance.view") && !!feature.data?.isEnabled;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="dashboard-title">
          {t("welcome", { name: data.displayName })}
        </h1>
        <p className="text-sm text-muted">{t("subtitle", { school: branding.schoolName })}</p>
      </div>
      {school && <SchoolOverview me={data} />}
      {teaches && <TeacherOverview homeroom={homeroom} />}
      <TodayLessonsCard />
      <Counts me={data} school={school} />
    </div>
  );
}

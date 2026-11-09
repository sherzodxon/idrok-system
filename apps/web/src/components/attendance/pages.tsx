"use client";

// M6 pages: the school's attendance (journal, Face Check, terminals, settings — each tab by permission), the class
// teacher's journal, and the student / guardian view (mobile-first) with a card for the portal home.
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, DoorOpen } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { StudentAttendanceDto, StudentSummary } from "@idrok/shared";
import { schoolToday } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { PageHeader, Tabs } from "@/components/ui/toolbar";
import { can, useMe } from "@/lib/use-me";
import { AttendanceStatusBadge, formatTime, useAttendanceFeature, useFormatDay } from "./common";
import { DevicesTab } from "./devices";
import { FaceCheck } from "./faces";
import { AttendanceJournal } from "./journal";
import { AttendanceSettingsTab } from "./settings";
import { StaffAttendance } from "./staff";

type Tab = "journal" | "staff" | "faces" | "devices" | "settings";

export function AdminAttendancePage() {
  const t = useTranslations("attendance");
  const me = useMe();
  const feature = useAttendanceFeature();
  const tabs = (
    [
      ["journal", "attendance.view"],
      ["staff", "employees.view"],
      ["faces", "face.manage"],
      ["devices", "devices.manage"],
      ["settings", "attendance.settings.manage"],
    ] as const
  )
    .filter(([, p]) => can(me.data, p))
    .map(([value]) => ({ value: value as Tab, label: t(`tabs.${value}`) }));
  const [tab, setTab] = useState<Tab>(tabs[0]?.value ?? "journal");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {feature.data && !feature.data.isEnabled && (
        <Card className="mb-4 p-4 text-sm text-warning" data-testid="attendance-disabled">
          {t("disabled")}
        </Card>
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "journal" && <AttendanceJournal />}
      {tab === "staff" && <StaffAttendance />}
      {tab === "faces" && <FaceCheck />}
      {tab === "devices" && <DevicesTab />}
      {tab === "settings" && <AttendanceSettingsTab />}
    </>
  );
}

export function TeacherAttendancePage() {
  const t = useTranslations("attendance");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("teacherSubtitle")} />
      <AttendanceJournal />
    </>
  );
}

function useStudentAttendance(studentId: string, days = 30) {
  const api = useApi();
  return useQuery({
    queryKey: ["attendance-student", studentId, days],
    queryFn: () => api.get<StudentAttendanceDto>(`/attendance/students/${studentId}`),
    enabled: !!studentId,
  });
}

function DayList({ data }: { data: StudentAttendanceDto }) {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const formatDay = useFormatDay();
  if (!data.days.length) return <EmptyState text={t("portal.noDays")} />;
  return (
    <ul className="divide-y divide-border" data-testid="attendance-days">
      {data.days.map((d) => (
        <li key={d.date} className="flex items-center gap-3 px-4 py-3 text-sm">
          <span className="w-20 shrink-0 text-muted">{formatDay(d.date)}</span>
          <AttendanceStatusBadge status={d.status} />
          <span className="ml-auto text-right tabular">
            {formatTime(d.firstInAt, locale)}
            {d.lastOutAt ? ` – ${formatTime(d.lastOutAt, locale)}` : ""}
            {d.lateMinutes > 0 && (
              <span className="block text-xs text-warning">{t("journal.lateMin", { n: d.lateMinutes })}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Counts({ data }: { data: StudentAttendanceDto }) {
  const t = useTranslations("attendance");
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      {(
        [
          ["PRESENT", "text-success"],
          ["LATE", "text-warning"],
          ["ABSENT", "text-danger"],
        ] as const
      ).map(([k, cls]) => (
        <Card key={k} className="p-3">
          <p className={`tabular text-lg font-bold ${cls}`}>{data.counts[k] ?? 0}</p>
          <p className="text-xs text-muted">{t(`status.${k}`)}</p>
        </Card>
      ))}
    </div>
  );
}

function useMyStudentId() {
  const api = useApi();
  const me = useMe();
  const guardian = can(me.data, "portal.guardian");
  const children = useQuery({
    queryKey: ["children"],
    queryFn: () => api.get<StudentSummary[]>("/me/children"),
    enabled: guardian,
  });
  const [childId, setChildId] = useState("");
  const studentId = guardian ? childId || children.data?.[0]?.id || "" : (me.data?.profiles.studentId ?? "");
  return { guardian, children: children.data ?? [], studentId, setChildId };
}

export function PortalAttendancePage() {
  const t = useTranslations("attendance");
  const feature = useAttendanceFeature();
  const { guardian, children, studentId, setChildId } = useMyStudentId();
  const data = useStudentAttendance(studentId);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-foreground">{t("portal.title")}</h1>
      {guardian && children.length > 1 && (
        <Select aria-label={t("portal.child")} value={studentId} onChange={(e) => setChildId(e.target.value)}>
          {children.map((c) => (
            <option key={c.id} value={c.id}>{`${c.lastName} ${c.firstName}`}</option>
          ))}
        </Select>
      )}
      {feature.data && !feature.data.isEnabled ? (
        <EmptyState text={t("portal.disabled")} />
      ) : !studentId ? (
        <EmptyState text={t("portal.noChild")} />
      ) : (
        <QueryBoundary query={data}>
          {(d) => (
            <>
              <Counts data={d} />
              <p className="text-xs text-muted">{t("portal.last30")}</p>
              <Card>
                <DayList data={d} />
              </Card>
            </>
          )}
        </QueryBoundary>
      )}
    </div>
  );
}

/** Portal home: today's arrival of the student (or each child) with a link to the history. */
export function HomeAttendanceCard() {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const feature = useAttendanceFeature();
  const { studentId } = useMyStudentId();
  const data = useStudentAttendance(studentId);
  if (!feature.data?.isEnabled || !studentId) return null;
  const today = data.data?.days.find((d) => d.date === schoolToday());
  return (
    <Card data-testid="home-attendance">
      <Link href="/attendance" className="flex items-center gap-3 px-5 py-4">
        <span className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
          <DoorOpen className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t("portal.today")}</span>
          <span className="text-sm text-muted">
            {today
              ? today.firstInAt
                ? t("portal.arrivedAt", { time: formatTime(today.firstInAt, locale) })
                : t(`status.${today.status}`)
              : t("portal.noToday")}
          </span>
        </span>
        {today && <AttendanceStatusBadge status={today.status} />}
        <ChevronRight className="size-5 text-muted" aria-hidden />
      </Link>
    </Card>
  );
}

/** For staff on a student's profile (attendance.view). */
export function StudentAttendanceCard({ studentId }: { studentId: string }) {
  const t = useTranslations("attendance");
  const data = useStudentAttendance(studentId);
  return (
    <Card>
      <CardHeader title={t("portal.title")} />
      <QueryBoundary query={data}>
        {(d) => (
          <div className="flex flex-col gap-3 px-5 pb-5">
            <Counts data={d} />
            <DayList data={{ ...d, days: d.days.slice(0, 10) }} />
          </div>
        )}
      </QueryBoundary>
    </Card>
  );
}

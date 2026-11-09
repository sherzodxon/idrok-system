"use client";

// Staff attendance of a day (T-76): first IN and last OUT from the terminals against the staff working day. The API
// works it out; this page only shows it.
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { SchoolAttendanceStatusDto, StaffAttendanceDayDto } from "@idrok/shared";
import { schoolToday } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { SearchInput, Tabs, Toolbar } from "@/components/ui/toolbar";
import { AttendanceStatusBadge, formatTime } from "./common";

const STATUSES: SchoolAttendanceStatusDto[] = ["PRESENT", "LATE", "ABSENT", "NOT_ARRIVED", "NO_DATA"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function StaffAttendance() {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const api = useApi();
  const [date, setDate] = useState<string>(schoolToday());
  const [status, setStatus] = useState<SchoolAttendanceStatusDto | "">("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ date, page: String(page), pageSize: "50" });
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  const day = useQuery({
    queryKey: ["staff-day", params.toString()],
    queryFn: () => api.get<StaffAttendanceDayDto>(`/attendance/staff/day?${params.toString()}`),
  });
  const reset =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setPage(1);
    };
  return (
    <>
      <Card className="mb-4">
        <Toolbar>
          <Field label={t("journal.date")}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={date}
                max={schoolToday()}
                onChange={(e) => e.target.value && reset(setDate)(e.target.value)}
              />
            )}
          </Field>
          <SearchInput value={q} onChange={reset(setQ)} label={t("faces.searchStaff")} />
        </Toolbar>
      </Card>
      {day.data && (
        <p className="mb-3 text-sm text-muted">
          {t("staff.workday", { start: hhmm(day.data.startMinute), end: hhmm(day.data.endMinute) })}
        </p>
      )}
      <Tabs
        tabs={[
          { value: "" as const, label: t("journal.all", { n: day.data?.total ?? 0 }) },
          ...STATUSES.map((s) => ({ value: s, label: `${t(`status.${s}`)} · ${day.data?.counts[s] ?? 0}` })),
        ]}
        value={status}
        onChange={reset(setStatus)}
      />
      <Card>
        <QueryBoundary query={day} isEmpty={(d) => d.items.length === 0} empty={<EmptyState text={t("staff.empty")} />}>
          {(d) => (
            <>
              <DataTable
                testId="staff-day"
                rows={d.items.map((r) => ({ ...r, id: r.employeeId }))}
                columns={[
                  {
                    key: "employee",
                    header: t("faces.employee"),
                    primary: true,
                    cell: (r) => (
                      <span>
                        <span className="font-medium">{`${r.lastName} ${r.firstName}`}</span>
                        {r.positionTitle && <span className="ml-2 text-xs text-muted">{r.positionTitle}</span>}
                      </span>
                    ),
                  },
                  {
                    key: "status",
                    header: t("journal.status"),
                    cell: (r) => (
                      <span className="flex flex-wrap items-center gap-1">
                        <AttendanceStatusBadge status={r.status} />
                        {!r.hasFace && <Badge tone="neutral">{t("staff.noFace")}</Badge>}
                      </span>
                    ),
                  },
                  {
                    key: "in",
                    header: t("journal.in"),
                    cell: (r) => <span className="tabular">{formatTime(r.firstInAt, locale)}</span>,
                  },
                  {
                    key: "out",
                    header: t("journal.out"),
                    cell: (r) => <span className="tabular">{formatTime(r.lastOutAt, locale)}</span>,
                  },
                  {
                    key: "late",
                    header: t("journal.late"),
                    cell: (r) =>
                      [
                        r.lateMinutes > 0 ? t("journal.lateMin", { n: r.lateMinutes }) : null,
                        r.earlyLeaveMinutes > 0 ? t("journal.earlyLeave", { n: r.earlyLeaveMinutes }) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—",
                  },
                ]}
              />
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </QueryBoundary>
      </Card>
    </>
  );
}

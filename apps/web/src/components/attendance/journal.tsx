"use client";

// School attendance of a day (SCHOOL_ATTENDANCE): every expected student in the caller's scope with arrival, departure,
// lateness and a manual mark. Admin and deputies see the whole school, a class teacher their class.
import { useQuery } from "@tanstack/react-query";
import { PencilLine } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { AttendanceDayDto, AttendanceDayRowDto, SchoolAttendanceStatusDto } from "@idrok/shared";
import { schoolToday } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { FilterSelect, SearchInput, Tabs, Toolbar } from "@/components/ui/toolbar";
import { useActiveYear, useClassGroups } from "@/lib/queries";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";
import { AttendanceStatusBadge, formatTime } from "./common";

const STATUSES: SchoolAttendanceStatusDto[] = ["PRESENT", "LATE", "ABSENT", "NOT_ARRIVED", "EXCUSED", "NO_DATA"];

export function AttendanceJournal() {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const api = useApi();
  const me = useMe();
  const canMark = can(me.data, "attendance.mark");
  const year = useActiveYear();
  const classes = useClassGroups(year.data?.id);
  const [date, setDate] = useState<string>(schoolToday());
  const [classGroupId, setClassGroupId] = useState("");
  const [status, setStatus] = useState<SchoolAttendanceStatusDto | "">("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [marking, setMarking] = useState<AttendanceDayRowDto | null>(null);
  const params = new URLSearchParams({ date, page: String(page), pageSize: "50" });
  if (classGroupId) params.set("classGroupId", classGroupId);
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  const day = useQuery({
    queryKey: ["attendance-day", params.toString()],
    queryFn: () => api.get<AttendanceDayDto>(`/attendance/day?${params.toString()}`),
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
          <FilterSelect
            label={t("journal.class")}
            allLabel={t("journal.allClasses")}
            value={classGroupId}
            onChange={reset(setClassGroupId)}
            options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <SearchInput value={q} onChange={reset(setQ)} label={t("journal.search")} />
        </Toolbar>
      </Card>
      <Tabs
        tabs={[
          {
            value: "" as const,
            label: t("journal.all", { n: day.data ? Object.values(day.data.counts).reduce((a, b) => a + b, 0) : 0 }),
          },
          ...STATUSES.map((s) => ({ value: s, label: `${t(`status.${s}`)} · ${day.data?.counts[s] ?? 0}` })),
        ]}
        value={status}
        onChange={reset(setStatus)}
      />
      {(day.data?.counts.NO_DATA ?? 0) > 0 && (
        <p className="mb-3 text-sm text-muted" data-testid="no-data-hint">
          {t("journal.noDataHint")}
        </p>
      )}
      <Card>
        <QueryBoundary
          query={day}
          isEmpty={(d) => d.items.length === 0}
          empty={<EmptyState text={day.data && !day.data.schoolDay ? t("journal.dayOff") : t("journal.empty")} />}
        >
          {(d) => (
            <>
              <DataTable
                testId="attendance-day"
                rows={d.items.map((r) => ({ ...r, id: r.studentId }))}
                columns={[
                  {
                    key: "student",
                    header: t("journal.student"),
                    primary: true,
                    cell: (r) => (
                      <span>
                        <span className="font-medium">{`${r.lastName} ${r.firstName}`}</span>
                        <span className="ml-2 text-xs text-muted">{r.className}</span>
                      </span>
                    ),
                  },
                  {
                    key: "status",
                    header: t("journal.status"),
                    cell: (r) => (
                      <span className="flex flex-wrap items-center gap-1">
                        <AttendanceStatusBadge status={r.status} />
                        {r.manualStatus && (
                          <span className="text-xs text-muted" title={r.manualReason ?? undefined}>
                            {t("journal.manual")}
                          </span>
                        )}
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
                      r.lateMinutes > 0
                        ? r.latenessBandName
                          ? t("journal.lateText", { n: r.lateMinutes, band: r.latenessBandName })
                          : t("journal.lateMin", { n: r.lateMinutes })
                        : r.earlyLeaveMinutes > 0
                          ? t("journal.earlyLeave", { n: r.earlyLeaveMinutes })
                          : "—",
                  },
                  ...(canMark
                    ? [
                        {
                          key: "actions",
                          header: "",
                          cell: (r: AttendanceDayRowDto) => (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setMarking(r)}
                              aria-label={t("journal.mark")}
                            >
                              <PencilLine className="size-4" aria-hidden />
                              <span className="md:sr-only">{t("journal.mark")}</span>
                            </Button>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </QueryBoundary>
      </Card>
      {marking && <MarkDialog row={marking} date={date} onClose={() => setMarking(null)} />}
    </>
  );
}

function MarkDialog({ row, date, onClose }: { row: AttendanceDayRowDto; date: string; onClose: () => void }) {
  const t = useTranslations("attendance");
  const api = useApi();
  const [status, setStatus] = useState(row.manualStatus ?? "PRESENT");
  const [reason, setReason] = useState("");
  const path = `/attendance/students/${row.studentId}/days/${date}`;
  const mark = useSave(() => api.put(path, { status, reason }), ["attendance-day", "attendance-student"], onClose);
  const clear = useSave(() => api.post(`${path}/clear`, { reason }), ["attendance-day", "attendance-student"], onClose);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${row.lastName} ${row.firstName}`}
      footer={
        <>
          {row.manualStatus && (
            <Button
              variant="secondary"
              disabled={!reason.trim()}
              loading={clear.isPending}
              onClick={() => clear.mutate(undefined)}
            >
              {t("journal.clearMark")}
            </Button>
          )}
          <Button form="attendance-mark" type="submit" loading={mark.isPending} data-testid="save-mark">
            {t("journal.saveMark")}
          </Button>
        </>
      }
    >
      <form
        id="attendance-mark"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), mark.mutate(undefined))}
      >
        <p className="text-sm text-muted">
          {t("journal.deviceSays")} <AttendanceStatusBadge status={row.deviceStatus} />
        </p>
        <Field label={t("journal.status")}>
          {(id) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              {(["PRESENT", "LATE", "ABSENT", "EXCUSED"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("journal.reason")}>
          {(id) => (
            <Input id={id} required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>
      </form>
    </Modal>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import type {
  AcademicPeriodDto,
  BellScheduleDto,
  CalendarDayDto,
  RoomDto,
  SchoolWeekDto,
  ShiftDto,
} from "@idrok/shared";
import {
  addSchoolDays,
  eachSchoolDate,
  isoWeekday,
  monthRange,
  parseSchoolDate,
  schoolToday,
  type SchoolDate,
} from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDrawer } from "@/components/ui/form-drawer";
import { ConfirmDialog } from "@/components/ui/modal";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { FilterSelect, PageHeader, Tabs, Toolbar } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import { useActiveYear, useGrades, useShifts, useYears } from "@/lib/queries";
import { useListState } from "@/lib/use-list-state";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";

type Tab = "periods" | "month" | "week" | "bells" | "rooms";
const TABS: Tab[] = ["month", "periods", "week", "bells", "rooms"];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const DAY_KINDS = ["HOLIDAY", "VACATION", "NON_WORKING", "WORKING_OVERRIDE", "SHORTENED"] as const;
type DayKind = (typeof DAY_KINDS)[number];

/** Semantic tones of the marked days (no raw colours, CLAUDE.md §4). */
const KIND_STYLE: Record<DayKind, string> = {
  HOLIDAY: "bg-danger-soft text-danger",
  VACATION: "bg-warning-soft text-warning",
  NON_WORKING: "bg-surface-muted text-muted",
  WORKING_OVERRIDE: "bg-success-soft text-success",
  SHORTENED: "bg-info-soft text-info",
};

export function CalendarPage() {
  const t = useTranslations();
  const list = useListState(["tab", "year"] as const);
  const years = useYears();
  const active = useActiveYear();
  const tab = (TABS as string[]).includes(list.filters.tab) ? (list.filters.tab as Tab) : "month";
  const yearId = list.filters.year || active.data?.id || "";
  const year = years.data?.find((y) => y.id === yearId);
  return (
    <>
      <PageHeader title={t("calendar.title")} />
      <Toolbar>
        <FilterSelect
          label={t("structure.year")}
          allLabel={t("structure.activeYear")}
          value={list.filters.year}
          onChange={(v) => list.update({ year: v })}
          options={(years.data ?? []).map((y) => ({ value: y.id, label: y.name }))}
        />
      </Toolbar>
      <Tabs<Tab>
        value={tab}
        onChange={(v) => list.update({ tab: v })}
        tabs={TABS.map((v) => ({ value: v, label: t(`calendar.tabs.${v}`) }))}
      />
      {!year ? (
        <QueryBoundary query={years} isEmpty={() => true} empty={<EmptyState text={t("structure.noYears")} />}>
          {() => null}
        </QueryBoundary>
      ) : (
        <>
          {tab === "month" && <MonthTab yearId={year.id} startDate={year.startDate} endDate={year.endDate} />}
          {tab === "periods" && <PeriodsTab yearId={year.id} />}
          {tab === "week" && <WeekTab yearId={year.id} />}
          {tab === "bells" && <BellsTab yearId={year.id} />}
          {tab === "rooms" && <RoomsTab />}
        </>
      )}
    </>
  );
}

function useManage() {
  const me = useMe();
  return can(me.data, "calendar.manage");
}

// ---------------------------------------------------------------- month

function useSchoolWeek(yearId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["school-week", yearId],
    queryFn: () => api.get<SchoolWeekDto>(`/academic-years/${yearId}/school-week`),
  });
}

function MonthTab({ yearId, startDate, endDate }: { yearId: string; startDate: string; endDate: string }) {
  const t = useTranslations();
  const api = useApi();
  const manage = useManage();
  const week = useSchoolWeek(yearId);
  const days = useQuery({
    queryKey: ["calendar-days", yearId],
    queryFn: () => api.get<CalendarDayDto[]>(`/academic-years/${yearId}/calendar-days`),
  });
  const today = schoolToday();
  const clampToYear = (d: string) => (d < startDate ? startDate : d > endDate ? endDate : d);
  const [month, setMonth] = useState(() => monthRange(parseSchoolDate(clampToYear(today))).from);
  const [selected, setSelected] = useState<{ date: SchoolDate; day: CalendarDayDto | null } | null>(null);

  const { from, to } = monthRange(month);
  // Grid from the Monday on or before the 1st to the Sunday on or after the last day.
  const gridFrom = addSchoolDays(from, 1 - isoWeekday(from));
  const gridTo = addSchoolDays(to, 7 - isoWeekday(to));
  const cells = [...eachSchoolDate(gridFrom, gridTo)];
  const byDate = useMemo(() => new Map((days.data ?? []).map((d) => [d.date, d])), [days.data]);
  const working = new Set(week.data?.workingWeekdays ?? []);
  // Month names come from the messages: browsers without full ICU data print "2026 M11" for uz.
  const title = t("calendar.monthTitle", {
    month: t(`calendar.months.${Number(from.slice(5, 7))}`),
    year: from.slice(0, 4),
  });
  const shift = (months: number) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + months);
    setMonth(parseSchoolDate(d.toISOString().slice(0, 10)));
  };
  const weekdayName = (n: number) => t(`calendar.weekdaysShort.${n}`);

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("calendar.prevMonth")}
          disabled={from <= startDate}
          onClick={() => shift(-1)}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <h2 className="font-semibold capitalize" data-testid="calendar-month">
          {title}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("calendar.nextMonth")}
          disabled={to >= endDate}
          onClick={() => shift(1)}
        >
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
      <QueryBoundary query={days}>
        {() => (
          <div className="p-2 sm:p-4">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
              {WEEKDAYS.map((n) => (
                <div key={n} className="py-1">
                  {weekdayName(n)}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1" role="grid" aria-label={title}>
              {cells.map((date) => {
                const day = byDate.get(date);
                const inMonth = date >= from && date <= to;
                const inYear = date >= startDate && date <= endDate;
                const offDay = !working.has(isoWeekday(date));
                return (
                  <button
                    key={date}
                    type="button"
                    role="gridcell"
                    data-date={date}
                    data-kind={day?.kind ?? ""}
                    disabled={!inMonth || !inYear || (!manage && !day)}
                    onClick={() => setSelected({ date, day: day ?? null })}
                    className={cn(
                      "flex min-h-14 flex-col items-start gap-0.5 rounded-button border border-border p-1 text-left text-xs sm:min-h-20 sm:p-2",
                      !inMonth && "invisible",
                      inMonth && !inYear && "opacity-40",
                      offDay && !day && "bg-surface-muted text-muted",
                      day && KIND_STYLE[day.kind],
                      date === today && "ring-2 ring-primary",
                      "enabled:hover:border-primary disabled:cursor-default",
                    )}
                  >
                    <span className="tabular font-semibold">{Number(date.slice(8))}</span>
                    {day && <span className="line-clamp-2 hidden sm:block">{day.title}</span>}
                  </button>
                );
              })}
            </div>
            <ul className="mt-4 flex flex-wrap gap-2 text-xs">
              {DAY_KINDS.map((k) => (
                <li key={k} className={cn("rounded-full px-2.5 py-0.5", KIND_STYLE[k])}>
                  {t(`calendar.kinds.${k}`)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </QueryBoundary>
      {selected && (
        <DayDrawer
          yearId={yearId}
          date={selected.date}
          day={selected.day}
          readOnly={!manage}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  );
}

function DayDrawer({
  yearId,
  date,
  day,
  readOnly,
  onClose,
}: {
  yearId: string;
  date: SchoolDate;
  day: CalendarDayDto | null;
  readOnly: boolean;
  onClose: () => void;
}) {
  const t = useTranslations();
  const api = useApi();
  const grades = useGrades();
  const [kind, setKind] = useState<DayKind>(day?.kind ?? "HOLIDAY");
  const [title, setTitle] = useState(day?.title ?? "");
  const [until, setUntil] = useState<string>(date);
  const [follows, setFollows] = useState(String(day?.followsWeekday ?? 1));
  const [gradeIds, setGradeIds] = useState<string[]>(day?.gradeIds ?? []);
  const [deleting, setDeleting] = useState(false);
  const invalidate = ["calendar-days"];
  const save = useSave(
    (body: object) =>
      day ? api.patch(`/calendar-days/${day.id}`, body) : api.post(`/academic-years/${yearId}/calendar-days`, body),
    invalidate,
    onClose,
  );
  const remove = useSave(() => api.delete(`/calendar-days/${day!.id}`), invalidate, onClose);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fields = {
      kind,
      title,
      followsWeekday: kind === "WORKING_OVERRIDE" ? Number(follows) : null,
      gradeIds,
    };
    save.mutate(day ? fields : until > date ? { from: date, to: until, ...fields } : { date, ...fields });
  };
  const toggleGrade = (id: string) =>
    setGradeIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  return (
    <FormDrawer title={date} formId="day-form" busy={save.isPending} onClose={onClose}>
      <form id="day-form" className="flex flex-col gap-4" onSubmit={submit}>
        <fieldset disabled={readOnly} className="flex flex-col gap-4">
          <Field label={t("calendar.kind")}>
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as DayKind)} data-testid="day-kind">
                {DAY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`calendar.kinds.${k}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("calendar.dayTitle")}>
            {(id) => (
              <Input
                id={id}
                required
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="day-title"
              />
            )}
          </Field>
          {!day && (
            <Field label={t("calendar.until")} hint={t("calendar.untilHint")}>
              {(id, d) => (
                <Input
                  id={id}
                  aria-describedby={d}
                  type="date"
                  min={date}
                  value={until}
                  onChange={(e) => setUntil(e.target.value || date)}
                />
              )}
            </Field>
          )}
          {kind === "WORKING_OVERRIDE" && (
            <Field label={t("calendar.followsWeekday")}>
              {(id) => (
                <Select id={id} value={follows} onChange={(e) => setFollows(e.target.value)}>
                  {WEEKDAYS.map((n) => (
                    <option key={n} value={n}>
                      {t(`calendar.weekdays.${n}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("calendar.appliesTo")}</legend>
            <p className="text-xs text-muted">{t("calendar.appliesToHint")}</p>
            <div className="flex flex-wrap gap-2">
              {(grades.data ?? []).map((g) => (
                <label key={g.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={gradeIds.includes(g.id)} onChange={() => toggleGrade(g.id)} />
                  {g.name}
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>
        {day && !readOnly && (
          <Button type="button" variant="ghost" onClick={() => setDeleting(true)} data-testid="day-delete">
            <Trash2 className="size-4" aria-hidden />
            {t("calendar.unmark")}
          </Button>
        )}
      </form>
      <ConfirmDialog
        open={deleting}
        danger
        title={t("calendar.unmark")}
        text={t("calendar.unmarkConfirm")}
        loading={remove.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={() => remove.mutate(undefined)}
      />
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- periods

function usePeriods(yearId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["periods", yearId],
    queryFn: () => api.get<AcademicPeriodDto[]>(`/academic-years/${yearId}/periods`),
  });
}

function PeriodsTab({ yearId }: { yearId: string }) {
  const t = useTranslations();
  const api = useApi();
  const manage = useManage();
  const periods = usePeriods(yearId);
  const [editing, setEditing] = useState<AcademicPeriodDto | "new" | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const activate = useSave(
    (id: string) => api.post(`/periods/${id}/activate`),
    ["periods"],
    () => setActivating(null),
  );
  return (
    <Card>
      {manage && (
        <Toolbar>
          <Button onClick={() => setEditing("new")} data-testid="period-add">
            <Plus className="size-4" aria-hidden />
            {t("calendar.addPeriod")}
          </Button>
        </Toolbar>
      )}
      <QueryBoundary
        query={periods}
        isEmpty={(p) => p.length === 0}
        empty={<EmptyState text={t("calendar.noPeriods")} />}
      >
        {(rows) => (
          <DataTable
            testId="periods-table"
            rows={rows}
            onRowClick={manage ? (p) => setEditing(p) : undefined}
            columns={[
              { key: "name", header: t("calendar.periodName"), primary: true, cell: (p) => p.name },
              { key: "type", header: t("calendar.periodType"), cell: (p) => t(`calendar.periodTypes.${p.type}`) },
              {
                key: "dates",
                header: t("structure.dates"),
                cell: (p) => <span className="tabular">{`${p.startDate} — ${p.endDate}`}</span>,
              },
              {
                key: "status",
                header: t("students.statusLabel"),
                cell: (p) => (
                  <Badge tone={p.status === "ACTIVE" ? "success" : "neutral"}>
                    {t(`calendar.periodStatus.${p.status}`)}
                  </Badge>
                ),
              },
              {
                key: "actions",
                header: "",
                className: "text-right",
                cell: (p) =>
                  manage && p.status === "DRAFT" ? (
                    <Button size="sm" variant="secondary" onClick={(e) => (e.stopPropagation(), setActivating(p.id))}>
                      {t("structure.activate")}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </QueryBoundary>
      {editing && (
        <PeriodDrawer
          yearId={yearId}
          period={editing === "new" ? null : editing}
          periods={periods.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!activating}
        title={t("structure.activate")}
        text={t("calendar.activatePeriodConfirm")}
        loading={activate.isPending}
        onCancel={() => setActivating(null)}
        onConfirm={() => activating && activate.mutate(activating)}
      />
    </Card>
  );
}

const PERIOD_TYPES = ["QUARTER", "HALF", "YEAR", "CUSTOM"] as const;

function PeriodDrawer({
  yearId,
  period,
  periods,
  onClose,
}: {
  yearId: string;
  period: AcademicPeriodDto | null;
  periods: AcademicPeriodDto[];
  onClose: () => void;
}) {
  const t = useTranslations();
  const api = useApi();
  const [type, setType] = useState<(typeof PERIOD_TYPES)[number]>(period?.type ?? "QUARTER");
  const [name, setName] = useState(period?.name ?? "");
  const [order, setOrder] = useState(String(period?.order ?? 1));
  const [startDate, setStart] = useState<string>(period?.startDate ?? "");
  const [endDate, setEnd] = useState<string>(period?.endDate ?? "");
  const [parentId, setParentId] = useState(period?.parentId ?? "");
  const datesLocked = period !== null && period.status !== "DRAFT";
  const save = useSave(
    (body: object) =>
      period ? api.patch(`/periods/${period.id}`, body) : api.post(`/academic-years/${yearId}/periods`, body),
    ["periods"],
    onClose,
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const dates = datesLocked ? {} : { startDate, endDate };
    save.mutate(
      period
        ? { name, ...dates, parentId: parentId || null }
        : { type, name, order: Number(order), startDate, endDate, parentId: parentId || null },
    );
  };
  return (
    <FormDrawer
      title={period ? period.name : t("calendar.addPeriod")}
      formId="period-form"
      busy={save.isPending}
      onClose={onClose}
    >
      <form id="period-form" className="flex flex-col gap-4" onSubmit={submit}>
        {!period && (
          <>
            <Field label={t("calendar.periodType")}>
              {(id) => (
                <Select id={id} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                  {PERIOD_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {t(`calendar.periodTypes.${p}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("calendar.order")}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={20}
                  required
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                />
              )}
            </Field>
          </>
        )}
        <Field label={t("calendar.periodName")}>
          {(id) => <Input id={id} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t("structure.startDate")} hint={datesLocked ? t("calendar.datesLocked") : undefined}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="date"
              required
              disabled={datesLocked}
              value={startDate}
              onChange={(e) => setStart(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("structure.endDate")}>
          {(id) => (
            <Input
              id={id}
              type="date"
              required
              disabled={datesLocked}
              value={endDate}
              onChange={(e) => setEnd(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("calendar.parent")}>
          {(id) => (
            <Select id={id} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">—</option>
              {periods
                .filter((p) => p.id !== period?.id && p.type !== (period?.type ?? type))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- school week

function WeekTab({ yearId }: { yearId: string }) {
  const t = useTranslations();
  const api = useApi();
  const manage = useManage();
  const week = useSchoolWeek(yearId);
  const [choice, setChoice] = useState<number[] | null>(null);
  const days = choice ?? week.data?.workingWeekdays ?? [];
  const save = useSave(
    (workingWeekdays: number[]) => api.put(`/academic-years/${yearId}/school-week`, { workingWeekdays }),
    ["school-week"],
    () => setChoice(null),
  );
  const toggle = (n: number) => setChoice(days.includes(n) ? days.filter((d) => d !== n) : [...days, n].sort());
  return (
    <Card className="p-5">
      <QueryBoundary query={week}>
        {(w) => (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">{w.configured ? t("calendar.weekHint") : t("calendar.weekDefault")}</p>
            <fieldset className="flex flex-wrap gap-3" disabled={!manage}>
              <legend className="sr-only">{t("calendar.tabs.week")}</legend>
              {WEEKDAYS.map((n) => (
                <label
                  key={n}
                  className="flex items-center gap-2 rounded-button border border-border px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={days.includes(n)}
                    onChange={() => toggle(n)}
                    data-testid={`weekday-${n}`}
                  />
                  {t(`calendar.weekdays.${n}`)}
                </label>
              ))}
            </fieldset>
            {manage && (
              <div>
                <Button
                  disabled={choice === null || days.length === 0}
                  loading={save.isPending}
                  onClick={() => save.mutate(days)}
                  data-testid="week-save"
                >
                  {t("common.save")}
                </Button>
              </div>
            )}
          </div>
        )}
      </QueryBoundary>
    </Card>
  );
}

// ---------------------------------------------------------------- shifts and bells

function BellsTab({ yearId }: { yearId: string }) {
  const t = useTranslations();
  const api = useApi();
  const manage = useManage();
  const shifts = useShifts();
  const schedules = useQuery({
    queryKey: ["bell-schedules", yearId],
    queryFn: () => api.get<BellScheduleDto[]>(`/academic-years/${yearId}/bell-schedules`),
  });
  const [shiftEditing, setShiftEditing] = useState<ShiftDto | "new" | null>(null);
  const [bellEditing, setBellEditing] = useState<BellScheduleDto | "new" | null>(null);
  const shiftName = (id: string | null) =>
    id ? (shifts.data?.find((s) => s.id === id)?.name ?? "—") : t("calendar.allShifts");
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title={t("calendar.shifts")}
          action={
            manage && (
              <Button size="sm" onClick={() => setShiftEditing("new")} data-testid="shift-add">
                <Plus className="size-4" aria-hidden />
                {t("calendar.addShift")}
              </Button>
            )
          }
        />
        <QueryBoundary
          query={shifts}
          isEmpty={(s) => s.length === 0}
          empty={<EmptyState text={t("calendar.noShifts")} />}
        >
          {(rows) => (
            <DataTable
              rows={rows}
              onRowClick={manage ? (s) => setShiftEditing(s) : undefined}
              columns={[
                { key: "name", header: t("calendar.shift"), primary: true, cell: (s) => s.name },
                {
                  key: "time",
                  header: t("calendar.time"),
                  cell: (s) => <span className="tabular">{`${s.startTime}–${s.endTime}`}</span>,
                },
                {
                  key: "status",
                  header: t("students.statusLabel"),
                  cell: (s) => (s.archived ? <Badge>{t("structure.archived")}</Badge> : null),
                },
              ]}
            />
          )}
        </QueryBoundary>
      </Card>
      <Card>
        <CardHeader
          title={t("calendar.bells")}
          action={
            manage && (
              <Button size="sm" onClick={() => setBellEditing("new")} data-testid="bells-add">
                <Plus className="size-4" aria-hidden />
                {t("calendar.addBells")}
              </Button>
            )
          }
        />
        <QueryBoundary
          query={schedules}
          isEmpty={(s) => s.length === 0}
          empty={<EmptyState text={t("calendar.noBells")} />}
        >
          {(rows) => (
            <ul className="divide-y divide-border">
              {rows.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    disabled={!manage}
                    onClick={() => setBellEditing(b)}
                    className="flex w-full flex-col gap-2 px-4 py-3 text-left enabled:hover:bg-surface-muted"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{b.name}</span>
                      <Badge>{shiftName(b.shiftId)}</Badge>
                      <span className="text-xs text-muted">{t("calendar.validFrom", { date: b.validFrom })}</span>
                    </span>
                    <span className="flex flex-wrap gap-1.5 text-xs">
                      {b.slots.map((slot) => (
                        <span key={slot.lessonNumber} className="tabular rounded-button bg-surface-muted px-2 py-0.5">
                          {`${slot.lessonNumber}. ${slot.startTime}–${slot.endTime}`}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </Card>
      {shiftEditing && (
        <ShiftDrawer shift={shiftEditing === "new" ? null : shiftEditing} onClose={() => setShiftEditing(null)} />
      )}
      {bellEditing && (
        <BellDrawer
          yearId={yearId}
          schedule={bellEditing === "new" ? null : bellEditing}
          shifts={(shifts.data ?? []).filter((s) => !s.archived)}
          onClose={() => setBellEditing(null)}
        />
      )}
    </div>
  );
}

function ShiftDrawer({ shift, onClose }: { shift: ShiftDto | null; onClose: () => void }) {
  const t = useTranslations();
  const api = useApi();
  const [name, setName] = useState(shift?.name ?? "");
  const [startTime, setStart] = useState(shift?.startTime ?? "08:00");
  const [endTime, setEnd] = useState(shift?.endTime ?? "13:00");
  const [archived, setArchived] = useState(shift?.archived ?? false);
  const save = useSave(
    (body: object) => (shift ? api.patch(`/shifts/${shift.id}`, body) : api.post("/shifts", body)),
    ["shifts"],
    onClose,
  );
  return (
    <FormDrawer
      title={shift?.name ?? t("calendar.addShift")}
      formId="shift-form"
      busy={save.isPending}
      onClose={onClose}
    >
      <form
        id="shift-form"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (
          e.preventDefault(),
          save.mutate(shift ? { name, startTime, endTime, archived } : { name, startTime, endTime })
        )}
      >
        <Field label={t("calendar.shift")}>
          {(id) => <Input id={id} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("calendar.start")}>
            {(id) => (
              <Input id={id} type="time" required value={startTime} onChange={(e) => setStart(e.target.value)} />
            )}
          </Field>
          <Field label={t("calendar.end")}>
            {(id) => <Input id={id} type="time" required value={endTime} onChange={(e) => setEnd(e.target.value)} />}
          </Field>
        </div>
        {shift && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            {t("structure.archive")}
          </label>
        )}
      </form>
    </FormDrawer>
  );
}

interface SlotRow {
  lessonNumber: number;
  startTime: string;
  endTime: string;
}

/** Next slot: a 45-minute lesson after a 10-minute break (only a starting suggestion). */
function nextSlot(prev: SlotRow | undefined): SlotRow {
  if (!prev) return { lessonNumber: 1, startTime: "08:00", endTime: "08:45" };
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const start = toMin(prev.endTime) + 10;
  return { lessonNumber: prev.lessonNumber + 1, startTime: fmt(start), endTime: fmt(start + 45) };
}

function BellDrawer({
  yearId,
  schedule,
  shifts,
  onClose,
}: {
  yearId: string;
  schedule: BellScheduleDto | null;
  shifts: ShiftDto[];
  onClose: () => void;
}) {
  const t = useTranslations();
  const api = useApi();
  const [name, setName] = useState(schedule?.name ?? "");
  const [shiftId, setShiftId] = useState(schedule?.shiftId ?? "");
  const [validFrom, setValidFrom] = useState<string>(schedule?.validFrom ?? "");
  const [slots, setSlots] = useState<SlotRow[]>(schedule?.slots ?? [nextSlot(undefined)]);
  const save = useSave(
    (body: object) =>
      schedule
        ? api.put(`/bell-schedules/${schedule.id}`, body)
        : api.post(`/academic-years/${yearId}/bell-schedules`, body),
    ["bell-schedules"],
    onClose,
  );
  const setSlot = (i: number, patch: Partial<SlotRow>) =>
    setSlots((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(schedule ? { name, validFrom, slots } : { name, shiftId: shiftId || null, validFrom, slots });
  };
  return (
    <FormDrawer
      title={schedule?.name ?? t("calendar.addBells")}
      formId="bells-form"
      busy={save.isPending}
      onClose={onClose}
    >
      <form id="bells-form" className="flex flex-col gap-4" onSubmit={submit}>
        <Field label={t("calendar.bellsName")}>
          {(id) => <Input id={id} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        {!schedule && (
          <Field label={t("calendar.shift")}>
            {(id) => (
              <Select id={id} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
                <option value="">{t("calendar.allShifts")}</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t("calendar.validFromLabel")} hint={t("calendar.validFromHint")}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="date"
              required
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          )}
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t("calendar.slots")}</legend>
          {slots.map((slot, i) => (
            <div key={i} className="grid grid-cols-[3.5rem_1fr_1fr_auto] items-center gap-2">
              <Input
                aria-label={t("calendar.lessonNumber")}
                type="number"
                min={0}
                max={20}
                value={slot.lessonNumber}
                onChange={(e) => setSlot(i, { lessonNumber: Number(e.target.value) })}
              />
              <Input
                aria-label={t("calendar.start")}
                type="time"
                required
                value={slot.startTime}
                onChange={(e) => setSlot(i, { startTime: e.target.value })}
              />
              <Input
                aria-label={t("calendar.end")}
                type="time"
                required
                value={slot.endTime}
                onChange={(e) => setSlot(i, { endTime: e.target.value })}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("calendar.removeSlot")}
                disabled={slots.length === 1}
                onClick={() => setSlots((rows) => rows.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setSlots((rows) => [...rows, nextSlot(rows.at(-1))])}
          >
            <Plus className="size-4" aria-hidden />
            {t("calendar.addSlot")}
          </Button>
        </fieldset>
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- rooms

function RoomsTab() {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const manage = can(me.data, "timetable.manage");
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: () => api.get<RoomDto[]>("/rooms") });
  const [editing, setEditing] = useState<RoomDto | "new" | null>(null);
  return (
    <Card>
      {manage && (
        <Toolbar>
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            {t("calendar.addRoom")}
          </Button>
        </Toolbar>
      )}
      <QueryBoundary query={rooms} isEmpty={(r) => r.length === 0} empty={<EmptyState text={t("calendar.noRooms")} />}>
        {(rows) => (
          <DataTable
            rows={rows}
            onRowClick={manage ? (r) => setEditing(r) : undefined}
            columns={[
              { key: "name", header: t("calendar.room"), primary: true, cell: (r) => r.name },
              { key: "capacity", header: t("structure.capacity"), cell: (r) => r.capacity ?? "—" },
              {
                key: "status",
                header: t("students.statusLabel"),
                cell: (r) => (r.archived ? <Badge>{t("structure.archived")}</Badge> : null),
              },
            ]}
          />
        )}
      </QueryBoundary>
      {editing && <RoomDrawer room={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function RoomDrawer({ room, onClose }: { room: RoomDto | null; onClose: () => void }) {
  const t = useTranslations();
  const api = useApi();
  const [name, setName] = useState(room?.name ?? "");
  const [capacity, setCapacity] = useState(room?.capacity ? String(room.capacity) : "");
  const [archived, setArchived] = useState(room?.archived ?? false);
  const save = useSave(
    (body: object) => (room ? api.patch(`/rooms/${room.id}`, body) : api.post("/rooms", body)),
    ["rooms"],
    onClose,
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const common = { name, capacity: capacity ? Number(capacity) : null };
    save.mutate(room ? { ...common, archived } : common);
  };
  return (
    <FormDrawer title={room?.name ?? t("calendar.addRoom")} formId="room-form" busy={save.isPending} onClose={onClose}>
      <form id="room-form" className="flex flex-col gap-4" onSubmit={submit}>
        <Field label={t("calendar.room")}>
          {(id) => <Input id={id} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t("structure.capacity")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={500}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          )}
        </Field>
        {room && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            {t("structure.archive")}
          </label>
        )}
      </form>
    </FormDrawer>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type {
  BellScheduleDto,
  LessonGenerationPreviewDto,
  Page,
  SchoolWeekDto,
  TeacherAssignmentDto,
  TimetableDetailDto,
  TimetableEntryDto,
  TimetableEntryInput,
  TimetableSummaryDto,
} from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDrawer } from "@/components/ui/form-drawer";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { FilterSelect, PageHeader, Tabs, Toolbar } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import {
  personName,
  useActiveYear,
  useClassGroups,
  useEmployees,
  useSubjects,
  useTeachingGroups,
  useYears,
} from "@/lib/queries";
import { useListState } from "@/lib/use-list-state";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";

type View = "class" | "teacher";
const DEFAULT_LESSONS = 7;

const toInput = (e: TimetableEntryDto): TimetableEntryInput => ({
  teachingGroupId: e.teachingGroupId,
  subjectId: e.subjectId,
  teacherId: e.teacherId,
  roomId: e.roomId,
  weekday: e.weekday,
  lessonNumber: e.lessonNumber,
  weekType: e.weekType,
});

export function TimetablePage() {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const list = useListState(["year", "version", "view", "id"] as const);
  const years = useYears();
  const active = useActiveYear();
  const yearId = list.filters.year || active.data?.id || "";
  const versions = useQuery({
    queryKey: ["timetables", yearId],
    queryFn: () => api.get<TimetableSummaryDto[]>(`/academic-years/${yearId}/timetables`),
    enabled: !!yearId,
  });
  // Default: the newest draft, else the newest version.
  const current =
    versions.data?.find((v) => v.id === list.filters.version) ??
    versions.data?.find((v) => v.status === "DRAFT") ??
    versions.data?.[0];
  const manage = can(me.data, "timetable.manage");
  const [creating, setCreating] = useState(false);
  const create = useSave(
    () =>
      api.post<TimetableSummaryDto>(`/academic-years/${yearId}/timetables`, current ? { copyFromId: current.id } : {}),
    ["timetables"],
    () => setCreating(false),
  );
  return (
    <>
      <PageHeader title={t("timetable.title")} />
      <Toolbar>
        <FilterSelect
          label={t("structure.year")}
          allLabel={t("structure.activeYear")}
          value={list.filters.year}
          onChange={(v) => list.update({ year: v, version: "" })}
          options={(years.data ?? []).map((y) => ({ value: y.id, label: y.name }))}
        />
        {versions.data && versions.data.length > 0 && (
          <label className="block w-full sm:w-auto">
            <span className="sr-only">{t("timetable.version")}</span>
            <Select
              compact
              aria-label={t("timetable.version")}
              value={current?.id ?? ""}
              onChange={(e) => list.update({ version: e.target.value })}
              data-testid="timetable-version"
            >
              {versions.data.map((v) => (
                <option key={v.id} value={v.id}>
                  {t("timetable.versionLabel", { version: v.version, status: t(`timetable.status.${v.status}`) })}
                </option>
              ))}
            </Select>
          </label>
        )}
        {manage && yearId && (
          <Button variant="secondary" onClick={() => setCreating(true)} data-testid="timetable-new">
            <Plus className="size-4" aria-hidden />
            {t("timetable.newVersion")}
          </Button>
        )}
      </Toolbar>
      <QueryBoundary
        query={versions}
        isEmpty={(v) => v.length === 0}
        empty={
          <Card>
            <EmptyState text={t("timetable.noVersions")} />
          </Card>
        }
      >
        {() => (current ? <Editor key={current.id} yearId={yearId} summary={current} /> : null)}
      </QueryBoundary>
      <ConfirmDialog
        open={creating}
        title={t("timetable.newVersion")}
        text={current ? t("timetable.newVersionCopy", { version: current.version }) : t("timetable.newVersionEmpty")}
        loading={create.isPending}
        onCancel={() => setCreating(false)}
        onConfirm={() => create.mutate(undefined)}
      />
    </>
  );
}

function Editor({ yearId, summary }: { yearId: string; summary: TimetableSummaryDto }) {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const list = useListState(["view", "id"] as const);
  const view: View = list.filters.view === "teacher" ? "teacher" : "class";
  const classes = useClassGroups(yearId);
  const employees = useEmployees();
  const detail = useQuery({
    queryKey: ["timetables", "detail", summary.id],
    queryFn: () => api.get<TimetableDetailDto>(`/timetables/${summary.id}`),
  });
  const week = useQuery({
    queryKey: ["school-week", yearId],
    queryFn: () => api.get<SchoolWeekDto>(`/academic-years/${yearId}/school-week`),
  });
  const bells = useQuery({
    queryKey: ["bell-schedules", yearId],
    queryFn: () => api.get<BellScheduleDto[]>(`/academic-years/${yearId}/bell-schedules`),
  });
  const editable = summary.status === "DRAFT" && can(me.data, "timetable.manage");
  const options =
    view === "class"
      ? (classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))
      : (employees.data ?? []).map((e) => ({ value: e.id, label: personName(e) }));
  const selected = list.filters.id || options[0]?.value || "";
  const [cell, setCell] = useState<{ weekday: number; lessonNumber: number } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const save = useSave(
    (entries: TimetableEntryInput[]) => api.put(`/timetables/${summary.id}/entries`, { entries }),
    ["timetables"],
  );
  const remove = useSave(
    () => api.delete(`/timetables/${summary.id}`),
    ["timetables"],
    () => {
      setDeleting(false);
      list.update({ version: "" });
    },
  );

  const maxLesson = Math.max(
    DEFAULT_LESSONS,
    ...(bells.data ?? []).flatMap((b) => b.slots.map((s) => s.lessonNumber)),
    ...(detail.data?.entries ?? []).map((e) => e.lessonNumber),
  );
  const lessons = Array.from({ length: maxLesson }, (_, i) => i + 1);
  const weekdays = week.data?.workingWeekdays ?? [1, 2, 3, 4, 5, 6];

  return (
    <QueryBoundary query={detail}>
      {(d) => {
        const shown = d.entries.filter((e) =>
          view === "class" ? e.classGroupId === selected || e.teachingGroupId === selected : e.teacherId === selected,
        );
        const conflicted = new Set(d.conflicts.flatMap((c) => c.entryIds));
        const unassigned = new Set(d.warnings.map((w) => w.entryId));
        const at = (weekday: number, lessonNumber: number) =>
          shown.filter((e) => e.weekday === weekday && e.lessonNumber === lessonNumber);
        const replace = (next: TimetableEntryInput[]) => save.mutate(next);
        return (
          <div className="flex flex-col gap-4">
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <Badge
                tone={summary.status === "PUBLISHED" ? "success" : summary.status === "DRAFT" ? "warning" : "neutral"}
              >
                {t(`timetable.status.${summary.status}`)}
              </Badge>
              {summary.validFrom && (
                <span className="text-sm text-muted">
                  {summary.validTo
                    ? t("timetable.validRange", { from: summary.validFrom, to: summary.validTo })
                    : t("timetable.validFromOpen", { from: summary.validFrom })}
                </span>
              )}
              {d.conflicts.length > 0 && (
                <span className="flex items-center gap-1.5 text-sm text-danger" data-testid="timetable-conflicts">
                  <AlertTriangle className="size-4" aria-hidden />
                  {t("timetable.conflictCount", { count: d.conflicts.length })}
                </span>
              )}
              <span className="ml-auto flex flex-wrap gap-2">
                {summary.status === "DRAFT" && can(me.data, "timetable.publish") && (
                  <Button
                    disabled={d.entries.length === 0 || d.conflicts.length > 0}
                    onClick={() => setPublishing(true)}
                    data-testid="timetable-publish"
                  >
                    {t("timetable.publish")}
                  </Button>
                )}
                {summary.status !== "DRAFT" && can(me.data, "timetable.publish") && (
                  <Button variant="secondary" onClick={() => setGenerating(true)} data-testid="lessons-generate">
                    <RefreshCw className="size-4" aria-hidden />
                    {t("lessons.generate")}
                  </Button>
                )}
                {editable && (
                  <Button variant="ghost" onClick={() => setDeleting(true)}>
                    <Trash2 className="size-4" aria-hidden />
                    {t("timetable.deleteDraft")}
                  </Button>
                )}
              </span>
            </Card>
            <Card>
              <div className="flex flex-wrap gap-3 border-b border-border p-4">
                <Tabs<View>
                  value={view}
                  onChange={(v) => list.update({ view: v, id: "" })}
                  tabs={[
                    { value: "class", label: t("timetable.byClass") },
                    { value: "teacher", label: t("timetable.byTeacher") },
                  ]}
                />
                <label className="block w-full sm:w-auto">
                  <span className="sr-only">{t(view === "class" ? "students.class" : "structure.teacher")}</span>
                  <Select
                    compact
                    aria-label={t(view === "class" ? "students.class" : "structure.teacher")}
                    value={selected}
                    onChange={(e) => list.update({ id: e.target.value })}
                    data-testid="timetable-target"
                  >
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <div className="overflow-x-auto p-2 sm:p-4">
                <table
                  className="w-full min-w-[640px] table-fixed border-separate border-spacing-1 text-xs"
                  data-testid="timetable-grid"
                >
                  <thead>
                    <tr>
                      <th scope="col" className="w-10 text-muted">
                        #
                      </th>
                      {weekdays.map((w) => (
                        <th key={w} scope="col" className="py-1 font-medium text-muted">
                          {t(`calendar.weekdays.${w}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lessons.map((n) => (
                      <tr key={n}>
                        <th scope="row" className="tabular text-muted">
                          {n}
                        </th>
                        {weekdays.map((w) => {
                          const items = at(w, n);
                          const clickable = editable && view === "class" && !!selected;
                          return (
                            <td key={w} className="align-top">
                              <button
                                type="button"
                                disabled={!clickable}
                                onClick={() => setCell({ weekday: w, lessonNumber: n })}
                                data-cell={`${w}-${n}`}
                                className={cn(
                                  "flex min-h-14 w-full flex-col gap-1 rounded-button border border-border p-1.5 text-left",
                                  items.some((e) => conflicted.has(e.id)) && "border-danger bg-danger-soft",
                                  "enabled:hover:border-primary disabled:cursor-default",
                                )}
                              >
                                {items.map((e) => (
                                  <span key={e.id} className="flex flex-col leading-tight">
                                    <span className="font-medium">{e.subjectName}</span>
                                    <span className="text-muted">
                                      {view === "class" ? e.teacherName : e.teachingGroupName}
                                      {e.roomName ? ` · ${e.roomName}` : ""}
                                    </span>
                                    {(e.weekType !== "ALL" ||
                                      unassigned.has(e.id) ||
                                      e.classGroupId !== e.teachingGroupId) && (
                                      <span className="flex flex-wrap gap-1">
                                        {view === "class" && e.teachingGroupName.includes("·") && (
                                          <Badge>{e.teachingGroupName.split(" · ")[1]}</Badge>
                                        )}
                                        {e.weekType !== "ALL" && (
                                          <Badge>{t(`timetable.weekTypes.${e.weekType}`)}</Badge>
                                        )}
                                        {unassigned.has(e.id) && (
                                          <Badge tone="warning">{t("timetable.unassigned")}</Badge>
                                        )}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.conflicts.length > 0 && (
                <ul className="flex flex-col gap-1 border-t border-border p-4 text-sm text-danger">
                  {d.conflicts.map((c, i) => (
                    <li key={i}>
                      {t(`timetable.conflicts.${c.kind}`, {
                        weekday: t(`calendar.weekdays.${c.weekday}`),
                        lesson: c.lessonNumber,
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {cell && (
              <CellDrawer
                classGroupId={selected}
                className={options.find((o) => o.value === selected)?.label ?? ""}
                yearId={yearId}
                cell={cell}
                entries={at(cell.weekday, cell.lessonNumber)}
                busy={save.isPending}
                onAdd={(entry) => replace([...d.entries.map(toInput), entry])}
                onRemove={(id) => replace(d.entries.filter((e) => e.id !== id).map(toInput))}
                onClose={() => setCell(null)}
              />
            )}
            {publishing && (
              <PublishDialog
                summary={summary}
                onClose={() => setPublishing(false)}
                onPublished={() => (setPublishing(false), setGenerating(true))}
              />
            )}
            {generating && <GenerationDialog yearId={yearId} onClose={() => setGenerating(false)} />}
            <ConfirmDialog
              open={deleting}
              danger
              title={t("timetable.deleteDraft")}
              text={t("timetable.deleteDraftConfirm")}
              loading={remove.isPending}
              onCancel={() => setDeleting(false)}
              onConfirm={() => remove.mutate(undefined)}
            />
          </div>
        );
      }}
    </QueryBoundary>
  );
}

function CellDrawer({
  classGroupId,
  className,
  yearId,
  cell,
  entries,
  busy,
  onAdd,
  onRemove,
  onClose,
}: {
  classGroupId: string;
  className: string;
  yearId: string;
  cell: { weekday: number; lessonNumber: number };
  entries: TimetableEntryDto[];
  busy: boolean;
  onAdd: (entry: TimetableEntryInput) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const api = useApi();
  const groups = useTeachingGroups(classGroupId);
  const subjects = useSubjects();
  const employees = useEmployees();
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => api.get<{ id: string; name: string; archived: boolean }[]>("/rooms"),
  });
  const classGroup = groups.data?.find((g) => g.kind === "CLASS");
  const [groupId, setGroupId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [weekType, setWeekType] = useState<"ALL" | "ODD" | "EVEN">("ALL");
  const effectiveGroup = groupId || classGroup?.id || "";
  const assignments = useQuery({
    queryKey: ["teacher-assignments", "group", effectiveGroup],
    queryFn: () =>
      api
        .get<Page<TeacherAssignmentDto>>(
          `/teacher-assignments?academicYearId=${yearId}&teachingGroupId=${effectiveGroup}&pageSize=100`,
        )
        .then((p) => p.items.filter((a) => a.validTo === null)),
    enabled: !!effectiveGroup,
  });
  // Suggest the assigned teacher of the chosen subject.
  const suggested = assignments.data?.find((a) => a.subjectId === subjectId)?.teacherId ?? "";
  const teacher = teacherId || suggested;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAdd({
      teachingGroupId: effectiveGroup,
      subjectId,
      teacherId: teacher,
      roomId: roomId || null,
      weekday: cell.weekday,
      lessonNumber: cell.lessonNumber,
      weekType,
    });
    onClose();
  };
  return (
    <FormDrawer
      title={t("timetable.cellTitle", {
        className,
        weekday: t(`calendar.weekdays.${cell.weekday}`),
        lesson: cell.lessonNumber,
      })}
      formId="cell-form"
      busy={busy}
      saveLabel={t("common.add")}
      onClose={onClose}
    >
      {entries.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-2 rounded-button border border-border p-2 text-sm"
            >
              <span>
                <span className="font-medium">{e.subjectName}</span>
                <span className="text-muted">{` · ${e.teachingGroupName} · ${e.teacherName}`}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("timetable.removeLesson")}
                onClick={() => (onRemove(e.id), onClose())}
                data-testid="cell-remove"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form id="cell-form" className="flex flex-col gap-4" onSubmit={submit}>
        <Field label={t("structure.group")}>
          {(id) => (
            <Select id={id} value={effectiveGroup} onChange={(e) => setGroupId(e.target.value)}>
              {(groups.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.kind === "CLASS" ? t("timetable.wholeClass") : g.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("structure.subject")}>
          {(id) => (
            <Select
              id={id}
              required
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              data-testid="cell-subject"
            >
              <option value="">—</option>
              {(subjects.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t("structure.teacher")}
          hint={suggested && !teacherId ? t("timetable.teacherSuggested") : undefined}
        >
          {(id, d) => (
            <Select
              id={id}
              aria-describedby={d}
              required
              value={teacher}
              onChange={(e) => setTeacherId(e.target.value)}
              data-testid="cell-teacher"
            >
              <option value="">—</option>
              {(employees.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {personName(e)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("calendar.room")}>
          {(id) => (
            <Select id={id} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">—</option>
              {(rooms.data ?? [])
                .filter((r) => !r.archived)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label={t("timetable.weekType")}>
          {(id) => (
            <Select id={id} value={weekType} onChange={(e) => setWeekType(e.target.value as typeof weekType)}>
              {(["ALL", "ODD", "EVEN"] as const).map((w) => (
                <option key={w} value={w}>
                  {t(`timetable.weekTypes.${w}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </FormDrawer>
  );
}

function PublishDialog({
  summary,
  onClose,
  onPublished,
}: {
  summary: TimetableSummaryDto;
  onClose: () => void;
  onPublished: () => void;
}) {
  const t = useTranslations();
  const api = useApi();
  const [validFrom, setValidFrom] = useState("");
  const publish = useSave(
    (body: object) => api.post(`/timetables/${summary.id}/publish`, body),
    ["timetables"],
    onPublished,
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={t("timetable.publish")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="publish-form"
            loading={publish.isPending}
            disabled={!validFrom}
            data-testid="publish-confirm"
          >
            {t("timetable.publish")}
          </Button>
        </>
      }
    >
      <form
        id="publish-form"
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => (e.preventDefault(), publish.mutate({ validFrom }))}
      >
        <p className="text-sm text-muted">{t("timetable.publishHint")}</p>
        <Field label={t("calendar.validFromLabel")}>
          {(id) => (
            <Input
              id={id}
              type="date"
              required
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              data-testid="publish-date"
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

/** Review what the timetable and calendar change in the lessons, then apply (lesson-plan.md §3). */
function GenerationDialog({ yearId, onClose }: { yearId: string; onClose: () => void }) {
  const t = useTranslations();
  const api = useApi();
  const [includePast, setIncludePast] = useState(false);
  const preview = useQuery({
    queryKey: ["lesson-generation", yearId, includePast],
    queryFn: () =>
      api.post<LessonGenerationPreviewDto>(`/academic-years/${yearId}/lesson-generation/preview`, { includePast }),
    gcTime: 0,
  });
  const apply = useSave(
    (previewHash: string) =>
      api.post(`/academic-years/${yearId}/lesson-generation/apply`, { includePast, previewHash }),
    ["lesson-generation", "lesson-sessions"],
    onClose,
  );
  const p = preview.data;
  const nothing = p && p.add + p.update + p.cancel === 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={t("lessons.generate")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!p || nothing}
            loading={apply.isPending}
            onClick={() => p && apply.mutate(p.previewHash)}
            data-testid="lessons-apply"
          >
            {t("lessons.apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted">{t("lessons.generateHint")}</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} />
          {t("lessons.includePast")}
        </label>
        <QueryBoundary query={preview}>
          {(r) => (
            <div className="flex flex-col gap-3" data-testid="lessons-preview">
              <p className="text-muted">{t("lessons.range", { from: r.from, to: r.to })}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(["add", "update", "cancel", "unchanged"] as const).map((k) => (
                  <Card key={k} className="p-3">
                    <p className="text-xs text-muted">{t(`lessons.counts.${k}`)}</p>
                    <p className="tabular text-xl font-bold" data-count={k}>
                      {r[k]}
                    </p>
                  </Card>
                ))}
              </div>
              {nothing && <p>{t("lessons.nothingToDo")}</p>}
              {r.cancelSample.length > 0 && (
                <div>
                  <p className="mb-1 font-medium">{t("lessons.willCancel")}</p>
                  <ul className="max-h-40 overflow-y-auto text-xs">
                    {r.cancelSample.map((l) => (
                      <li key={`${l.teachingGroupId}-${l.date}-${l.lessonNumber}`} className="tabular">
                        {`${l.date} · ${l.lessonNumber} · ${l.teachingGroupName} · ${l.subjectName}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {r.blocked.length > 0 && (
                <p className="text-warning">{t("lessons.blocked", { count: r.blocked.length })}</p>
              )}
              {r.warnings.noPeriodDates.length > 0 && (
                <p className="text-warning">
                  {t("lessons.noPeriod", {
                    count: r.warnings.noPeriodDates.length,
                    first: r.warnings.noPeriodDates[0]!,
                  })}
                </p>
              )}
              {r.warnings.noBellSlot > 0 && (
                <p className="text-warning">{t("lessons.noBellSlot", { count: r.warnings.noBellSlot })}</p>
              )}
            </div>
          )}
        </QueryBoundary>
      </div>
    </Modal>
  );
}

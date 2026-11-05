"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import type {
  AcademicPeriodDto,
  LessonCountRowDto,
  LessonSessionDto,
  TeacherDayDto,
  PortalWeekDto,
  StudentSummary,
} from "@idrok/shared";
import { addSchoolDays, isoWeekday, schoolToday, weekRange, type SchoolDate } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDrawer } from "@/components/ui/form-drawer";
import { JournalLink } from "@/components/scores/scores-pages";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { FilterSelect, PageHeader, Tabs, Toolbar } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import { personName, useActiveYear, useClassGroups, useEmployees } from "@/lib/queries";
import { useListState } from "@/lib/use-list-state";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";

const STATUS_TONE = { SCHEDULED: "neutral", HELD: "success", CANCELLED: "danger", MOVED: "warning" } as const;

/** "08:00" in the school's time zone. */
const timeOf = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" }).format(
    new Date(iso),
  );

// ---------------------------------------------------------------- week navigation

function useWeek() {
  const [anchor, setAnchor] = useState<SchoolDate>(() => schoolToday());
  const { from, to } = weekRange(anchor);
  return { from, to, prev: () => setAnchor(addSchoolDays(from, -7)), next: () => setAnchor(addSchoolDays(from, 7)) };
}

function WeekNav({ week }: { week: ReturnType<typeof useWeek> }) {
  const t = useTranslations("lessons");
  return (
    <div className="flex items-center gap-2">
      <Button size="icon" variant="ghost" aria-label={t("prevWeek")} onClick={week.prev}>
        <ChevronLeft className="size-4" aria-hidden />
      </Button>
      <span className="tabular text-sm font-medium" data-testid="week-range">{`${week.from} — ${week.to}`}</span>
      <Button size="icon" variant="ghost" aria-label={t("nextWeek")} onClick={week.next}>
        <ChevronRight className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

/** Lessons grouped by day, in order. */
function ByDay<T extends { date: string; lessonNumber: number }>({
  lessons,
  render,
}: {
  lessons: T[];
  render: (lesson: T) => ReactNode;
}) {
  const t = useTranslations("calendar");
  const days = [...new Set(lessons.map((l) => l.date))].sort();
  return (
    <div className="flex flex-col gap-4">
      {days.map((date) => (
        <section key={date} data-day={date}>
          <h3 className="mb-2 text-sm font-semibold text-muted">
            {`${t(`weekdays.${isoWeekday(date as SchoolDate)}`)}, ${date}`}
          </h3>
          <ul className="flex flex-col gap-2">
            {lessons
              .filter((l) => l.date === date)
              .sort((a, b) => a.lessonNumber - b.lessonNumber)
              .map(render)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function LessonRow({ lesson, who, action }: { lesson: LessonSessionDto; who: string; action?: ReactNode }) {
  const t = useTranslations("lessons");
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface p-3",
        lesson.status === "CANCELLED" && "opacity-60",
      )}
      data-lesson={lesson.id}
    >
      <span className="tabular w-16 text-sm text-muted">{`${lesson.lessonNumber}. ${timeOf(lesson.startsAt)}`}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{`${lesson.subjectName} · ${who}`}</span>
        <span className="block text-sm text-muted">
          {lesson.actualTopicNote ?? lesson.topicTitle ?? t("noTopic")}
          {lesson.substituteTeacherName ? ` · ${t("substitute", { name: lesson.substituteTeacherName })}` : ""}
          {lesson.cancelReason ? ` · ${lesson.cancelReason}` : ""}
        </span>
      </span>
      {/* On a phone the status and actions take their own line, so the lesson text keeps its width. */}
      <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <Badge tone={STATUS_TONE[lesson.status]}>{t(`status.${lesson.status}`)}</Badge>
        {action}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------- marking held (§4.7)

function MarkHeldDrawer({ lesson, onClose }: { lesson: LessonSessionDto; onClose: () => void }) {
  const t = useTranslations();
  const api = useApi();
  const [note, setNote] = useState(lesson.actualTopicNote ?? "");
  const save = useSave(
    () => api.post(`/lesson-sessions/${lesson.id}/held`, { actualTopicNote: note.trim() || null }),
    ["lesson-sessions", "today-lessons"],
    onClose,
  );
  return (
    <FormDrawer
      title={`${lesson.subjectName} · ${lesson.teachingGroupName}`}
      formId="held-form"
      busy={save.isPending}
      saveLabel={t("lessons.markHeld")}
      onClose={onClose}
    >
      <form
        id="held-form"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <p className="text-sm">
          <span className="text-muted">{t("lessons.plannedTopic")}: </span>
          <span className="font-medium">{lesson.topicTitle ?? t("lessons.noTopic")}</span>
        </p>
        {lesson.homework && (
          <p className="text-sm">
            <span className="text-muted">{t("plans.homework")}: </span>
            {lesson.homework}
          </p>
        )}
        <Field label={t("lessons.actualTopic")} hint={t("lessons.actualTopicHint")}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              data-testid="held-note"
            />
          )}
        </Field>
      </form>
    </FormDrawer>
  );
}

function markable(lesson: LessonSessionDto) {
  return lesson.status !== "CANCELLED" && lesson.date <= schoolToday();
}

/** The teacher's day (today's lessons with score / attendance state); shared by the dashboard tiles and the card. */
export function useTeacherDay() {
  const api = useApi();
  const me = useMe();
  return useQuery({
    queryKey: ["today-lessons"],
    queryFn: () => api.get<TeacherDayDto>("/me/lessons/day"),
    enabled: can(me.data, "lessons.view") && !!me.data?.profiles.employeeId,
  });
}

/** "Bugungi darslarim" on the teacher's dashboard. */
export function TodayLessonsCard() {
  const t = useTranslations("lessons");
  const me = useMe();
  const today = useTeacherDay();
  const [marking, setMarking] = useState<LessonSessionDto | null>(null);
  if (!me.data?.profiles.employeeId || !can(me.data, "lessons.view")) return null;
  return (
    <Card>
      <CardHeader title={t("today")} />
      <div className="p-4">
        <QueryBoundary
          query={today}
          isEmpty={(d) => d.lessons.length === 0}
          empty={<EmptyState text={t("noLessonsToday")} />}
        >
          {(day) => (
            <ul className="flex flex-col gap-2" data-testid="today-lessons">
              {day.lessons.map((l) => (
                <LessonRow
                  key={l.id}
                  lesson={l}
                  who={l.teachingGroupName}
                  action={
                    <>
                      {l.started && l.status !== "CANCELLED" && (
                        <Badge tone={l.scoredStudents > 0 ? "success" : "warning"}>
                          {l.scoredStudents > 0 ? t("scored", { n: l.scoredStudents }) : t("notScored")}
                        </Badge>
                      )}
                      {can(me.data, "lessons.mark") && markable(l) && (
                        <Button
                          size="sm"
                          variant={l.status === "HELD" ? "ghost" : "secondary"}
                          onClick={() => setMarking(l)}
                          data-testid="mark-held"
                        >
                          <CheckCircle2 className="size-4" aria-hidden />
                          {t(l.status === "HELD" ? "editHeld" : "markHeld")}
                        </Button>
                      )}
                      {l.status !== "CANCELLED" && <JournalLink lessonId={l.id} />}
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </QueryBoundary>
      </div>
      {marking && <MarkHeldDrawer lesson={marking} onClose={() => setMarking(null)} />}
    </Card>
  );
}

// ---------------------------------------------------------------- teacher: my week

export function TeacherSchedulePage() {
  const t = useTranslations("lessons");
  const api = useApi();
  const me = useMe();
  const week = useWeek();
  const employeeId = me.data?.profiles.employeeId ?? "";
  const lessons = useQuery({
    queryKey: ["lesson-sessions", "mine", week.from],
    queryFn: () =>
      api.get<LessonSessionDto[]>(`/lesson-sessions?from=${week.from}&to=${week.to}&teacherId=${employeeId}`),
    enabled: !!employeeId,
  });
  const [marking, setMarking] = useState<LessonSessionDto | null>(null);
  return (
    <>
      <PageHeader title={t("mySchedule")} actions={<WeekNav week={week} />} />
      <QueryBoundary
        query={lessons}
        isEmpty={(l) => l.length === 0}
        empty={
          <Card>
            <EmptyState text={t("noLessonsWeek")} />
          </Card>
        }
      >
        {(rows) => (
          <ByDay
            lessons={rows}
            render={(l) => (
              <LessonRow
                key={l.id}
                lesson={l}
                who={l.teachingGroupName}
                action={
                  <>
                    {can(me.data, "lessons.mark") && markable(l) && (
                      <Button size="sm" variant="ghost" onClick={() => setMarking(l)}>
                        {t(l.status === "HELD" ? "editHeld" : "markHeld")}
                      </Button>
                    )}
                    {l.status !== "CANCELLED" && <JournalLink lessonId={l.id} />}
                  </>
                }
              />
            )}
          />
        )}
      </QueryBoundary>
      {marking && <MarkHeldDrawer lesson={marking} onClose={() => setMarking(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- admin: lessons of a class + report

type AdminTab = "week" | "counts";

export function AdminLessonsPage() {
  const t = useTranslations();
  const list = useListState(["tab"] as const);
  const tab: AdminTab = list.filters.tab === "counts" ? "counts" : "week";
  return (
    <>
      <PageHeader title={t("lessons.title")} />
      <Tabs<AdminTab>
        value={tab}
        onChange={(v) => list.update({ tab: v })}
        tabs={[
          { value: "week", label: t("lessons.tabs.week") },
          { value: "counts", label: t("lessons.tabs.counts") },
        ]}
      />
      {tab === "week" ? <ClassWeek /> : <LessonCounts />}
    </>
  );
}

function ClassWeek() {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const year = useActiveYear();
  const classes = useClassGroups(year.data?.id);
  const week = useWeek();
  const [classId, setClassId] = useState("");
  const selected = classId || classes.data?.[0]?.id || "";
  const lessons = useQuery({
    queryKey: ["lesson-sessions", "class", selected, week.from],
    queryFn: () =>
      api.get<LessonSessionDto[]>(
        `/lesson-sessions?from=${week.from}&to=${week.to}&classGroupId=${selected}&includeCancelled=true`,
      ),
    enabled: !!selected,
  });
  const [cancelling, setCancelling] = useState<LessonSessionDto | null>(null);
  const [substituting, setSubstituting] = useState<LessonSessionDto | null>(null);
  const manage = can(me.data, "timetable.manage");
  return (
    <Card>
      <Toolbar>
        <label className="block w-full sm:w-auto">
          <span className="sr-only">{t("students.class")}</span>
          <Select
            aria-label={t("students.class")}
            value={selected}
            onChange={(e) => setClassId(e.target.value)}
            data-testid="lessons-class"
          >
            {(classes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <WeekNav week={week} />
      </Toolbar>
      <div className="p-4">
        <QueryBoundary
          query={lessons}
          isEmpty={(l) => l.length === 0}
          empty={<EmptyState text={t("lessons.noLessonsWeek")} />}
        >
          {(rows) => (
            <ByDay
              lessons={rows}
              render={(l) => (
                <LessonRow
                  key={l.id}
                  lesson={l}
                  who={l.teacherName}
                  action={
                    manage && l.status === "SCHEDULED" ? (
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setSubstituting(l)}>
                          {t("lessons.setSubstitute")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(l)} data-testid="lesson-cancel">
                          {t("lessons.cancel")}
                        </Button>
                      </span>
                    ) : null
                  }
                />
              )}
            />
          )}
        </QueryBoundary>
      </div>
      {cancelling && <CancelDrawer lesson={cancelling} onClose={() => setCancelling(null)} />}
      {substituting && <SubstituteDrawer lesson={substituting} onClose={() => setSubstituting(null)} />}
    </Card>
  );
}

function CancelDrawer({ lesson, onClose }: { lesson: LessonSessionDto; onClose: () => void }) {
  const t = useTranslations();
  const api = useApi();
  const [reason, setReason] = useState("");
  const [reflowId, setReflowId] = useState<string | null>(null);
  const cancel = useSave(
    () =>
      api
        .post<{ planAssignmentId: string | null }>(`/lesson-sessions/${lesson.id}/cancel`, { reason })
        .then((r) => (r.planAssignmentId ? setReflowId(r.planAssignmentId) : onClose())),
    ["lesson-sessions"],
  );
  if (reflowId) return <ReflowDialog assignmentId={reflowId} onClose={onClose} />;
  return (
    <FormDrawer
      title={`${lesson.date} · ${lesson.subjectName}`}
      formId="cancel-form"
      busy={cancel.isPending}
      saveLabel={t("lessons.cancel")}
      onClose={onClose}
    >
      <form
        id="cancel-form"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), cancel.mutate(undefined))}
      >
        <p className="text-sm text-muted">{t("lessons.cancelHint")}</p>
        <Field label={t("common.reason")}>
          {(id) => (
            <Input
              id={id}
              required
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid="cancel-reason"
            />
          )}
        </Field>
      </form>
    </FormDrawer>
  );
}

function SubstituteDrawer({ lesson, onClose }: { lesson: LessonSessionDto; onClose: () => void }) {
  const t = useTranslations();
  const api = useApi();
  const employees = useEmployees();
  const [teacherId, setTeacherId] = useState(lesson.substituteTeacherId ?? "");
  const save = useSave(
    () => api.put(`/lesson-sessions/${lesson.id}/substitute`, { substituteTeacherId: teacherId || null }),
    ["lesson-sessions"],
    onClose,
  );
  return (
    <FormDrawer title={t("lessons.setSubstitute")} formId="substitute-form" busy={save.isPending} onClose={onClose}>
      <form
        id="substitute-form"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <p className="text-sm text-muted">{`${lesson.date} · ${lesson.lessonNumber} · ${lesson.subjectName} · ${lesson.teacherName}`}</p>
        <Field label={t("structure.teacher")}>
          {(id) => (
            <Select id={id} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              <option value="">{t("lessons.noSubstitute")}</option>
              {(employees.data ?? [])
                .filter((e) => e.id !== lesson.teacherId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {personName(e)}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      </form>
    </FormDrawer>
  );
}

function LessonCounts() {
  const t = useTranslations();
  const api = useApi();
  const year = useActiveYear();
  const yearId = year.data?.id ?? "";
  const [periodId, setPeriodId] = useState("");
  const periods = useQuery({
    queryKey: ["periods", yearId],
    queryFn: () => api.get<AcademicPeriodDto[]>(`/academic-years/${yearId}/periods`),
    enabled: !!yearId,
  });
  const rows = useQuery({
    queryKey: ["lesson-counts", yearId, periodId],
    queryFn: () =>
      api.get<LessonCountRowDto[]>(
        `/reports/lesson-counts?academicYearId=${yearId}${periodId ? `&periodId=${periodId}` : ""}`,
      ),
    enabled: !!yearId,
  });
  return (
    <Card>
      <Toolbar>
        <FilterSelect
          label={t("plans.period")}
          allLabel={t("lessons.wholeYear")}
          value={periodId}
          onChange={setPeriodId}
          options={(periods.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
        />
      </Toolbar>
      <QueryBoundary query={rows} isEmpty={(r) => r.length === 0} empty={<EmptyState text={t("lessons.noLessons")} />}>
        {(data) => (
          <DataTable
            testId="lesson-counts"
            rows={data.map((r) => ({ ...r, id: `${r.teachingGroupId}|${r.subjectId}` }))}
            columns={[
              { key: "group", header: t("structure.group"), primary: true, cell: (r) => r.teachingGroupName },
              { key: "subject", header: t("structure.subject"), cell: (r) => r.subjectName },
              {
                key: "planned",
                header: t("lessons.planned"),
                cell: (r) => <span className="tabular">{r.plannedHours ?? "—"}</span>,
              },
              {
                key: "lessons",
                header: t("lessons.byTimetable"),
                cell: (r) => <span className="tabular">{r.lessons}</span>,
              },
              { key: "held", header: t("lessons.held"), cell: (r) => <span className="tabular">{r.held}</span> },
              {
                key: "diff",
                header: t("lessons.difference"),
                cell: (r) =>
                  r.plannedHours === null ? (
                    <Badge>{t("lessons.noPlan")}</Badge>
                  ) : r.plannedHours === r.lessons ? (
                    <Badge tone="success">0</Badge>
                  ) : (
                    <Badge tone="warning">
                      {r.lessons - r.plannedHours > 0 ? `+${r.lessons - r.plannedHours}` : r.lessons - r.plannedHours}
                    </Badge>
                  ),
              },
            ]}
          />
        )}
      </QueryBoundary>
    </Card>
  );
}

// ---------------------------------------------------------------- reflow (§4.6)

export function ReflowDialog({ assignmentId, onClose }: { assignmentId: string; onClose: () => void }) {
  const t = useTranslations();
  const api = useApi();
  const preview = useQuery({
    queryKey: ["reflow", assignmentId],
    queryFn: () =>
      api.post<{
        teachingGroupName: string;
        changes: { date: string; lessonNumber: number; fromTopic: string | null; toTopic: string | null }[];
      }>(`/plan-assignments/${assignmentId}/reflow/preview`),
    gcTime: 0,
  });
  const apply = useSave(
    () => api.post(`/plan-assignments/${assignmentId}/reflow/apply`),
    ["lesson-sessions", "plan-assignments"],
    onClose,
  );
  const nothing = preview.data && preview.data.changes.length === 0;
  return (
    <FormDrawer
      title={t("lessons.reflow")}
      formId="reflow-form"
      busy={apply.isPending}
      saveLabel={t("lessons.apply")}
      onClose={onClose}
    >
      <form id="reflow-form" onSubmit={(e: FormEvent) => (e.preventDefault(), !nothing && apply.mutate(undefined))}>
        <p className="mb-3 text-sm text-muted">{t("lessons.reflowHint")}</p>
        <QueryBoundary query={preview}>
          {(p) =>
            p.changes.length === 0 ? (
              <p className="text-sm">{t("lessons.reflowNothing")}</p>
            ) : (
              <ul className="max-h-96 overflow-y-auto text-sm" data-testid="reflow-changes">
                {p.changes.map((c) => (
                  <li key={`${c.date}-${c.lessonNumber}`} className="border-b border-border py-1.5">
                    <span className="tabular text-muted">{`${c.date} · ${c.lessonNumber}: `}</span>
                    <span className="line-through opacity-60">{c.fromTopic ?? "—"}</span>
                    {" → "}
                    <span className="font-medium">{c.toTopic ?? "—"}</span>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryBoundary>
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- portal (mobile-first)

export function PortalSchedulePage() {
  const t = useTranslations("lessons");
  const api = useApi();
  const me = useMe();
  const week = useWeek();
  const guardian = can(me.data, "portal.guardian");
  const children = useQuery({
    queryKey: ["children"],
    queryFn: () => api.get<StudentSummary[]>("/me/children"),
    enabled: guardian,
  });
  const [childId, setChildId] = useState("");
  const studentId = guardian ? childId || children.data?.[0]?.id || "" : "";
  const lessons = useQuery({
    queryKey: ["portal-week", studentId, week.from],
    queryFn: () =>
      api.get<PortalWeekDto>(`/me/timetable?date=${week.from}${studentId ? `&studentId=${studentId}` : ""}`),
    enabled: !guardian || !!studentId,
  });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-foreground">{t("schedule")}</h1>
      {guardian && (children.data?.length ?? 0) > 1 && (
        <Select aria-label={t("child")} value={studentId} onChange={(e) => setChildId(e.target.value)}>
          {(children.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>{`${c.lastName} ${c.firstName}`}</option>
          ))}
        </Select>
      )}
      <WeekNav week={week} />
      <QueryBoundary
        query={lessons}
        isEmpty={(w) => w.lessons.length === 0}
        empty={
          <Card>
            <EmptyState text={t("noLessonsWeek")} />
          </Card>
        }
      >
        {(w) => (
          <ByDay
            lessons={w.lessons}
            render={(l) => (
              <li key={l.id} className="rounded-card border border-border bg-surface p-3" data-lesson={l.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{`${l.lessonNumber}. ${l.subjectName}`}</span>
                  <span className="tabular text-xs text-muted">{`${timeOf(l.startsAt)}–${timeOf(l.endsAt)}`}</span>
                </div>
                {l.status === "CANCELLED" ? (
                  <Badge tone="danger">{t("status.CANCELLED")}</Badge>
                ) : (
                  <>
                    <p className="text-sm">{l.topicTitle ?? t("noTopic")}</p>
                    {l.homework && <p className="text-sm text-muted">{t("homeworkLine", { text: l.homework })}</p>}
                  </>
                )}
              </li>
            )}
          />
        )}
      </QueryBoundary>
    </div>
  );
}

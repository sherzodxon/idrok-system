"use client";

// M3 screens (scoring.md §9): the lesson journal (also the phone quick mode), the gradebook grid and the student /
// guardian progress page. Saving is not optimistic: the screen updates after the server confirms, so a limit error is
// seen at once.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Undo2, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent } from "react";
import type {
  AcademicPeriodDto,
  AttendanceStatusCode,
  GradebookDto,
  LessonJournalDto,
  ManualScoreDto,
  Page,
  ProgressView,
  ScoreEntryDto,
  StudentProgressDto,
  StudentSummary,
  TeacherAssignmentDto,
} from "@idrok/shared";
import { addSchoolDays, monthRange, schoolToday, type SchoolDate } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ProgressRing } from "@/components/ui/stats";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { PageHeader, Tabs, Toolbar } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import { useActiveYear } from "@/lib/queries";
import { can, useMe } from "@/lib/use-me";
import { useErrorText } from "@/lib/use-error-text";
import { useListState } from "@/lib/use-list-state";

const ATTENDANCE: AttendanceStatusCode[] = ["PRESENT", "LATE", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED"];
const ATTENDANCE_TONE: Record<AttendanceStatusCode, string> = {
  PRESENT: "bg-success-soft text-success border-success",
  LATE: "bg-warning-soft text-warning border-warning",
  ABSENT_EXCUSED: "bg-surface-muted text-muted border-border-strong",
  ABSENT_UNEXCUSED: "bg-danger-soft text-danger border-danger",
};

/** Runs a server call; on success refreshes the given queries, on failure shows the translated error. */
function useAction() {
  const qc = useQueryClient();
  const toast = useToast();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    run: async (fn: () => Promise<unknown>, invalidate: string[]) => {
      setBusy(true);
      try {
        await fn();
        for (const key of invalidate) await qc.invalidateQueries({ queryKey: [key] });
        return true;
      } catch (err) {
        toast("error", errorText(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}

// ---------------------------------------------------------------- lesson journal (and phone quick mode)

export function LessonJournalPage({ lessonId, backHref }: { lessonId: string; backHref: string }) {
  const t = useTranslations("scores");
  const api = useApi();
  // The gradebook passes where to come back to (only a path of this app).
  const backParam = useSearchParams().get("back");
  const back = backParam?.startsWith("/") && !backParam.startsWith("//") ? backParam : backHref;
  const toast = useToast();
  const journal = useQuery({
    queryKey: ["journal", lessonId],
    queryFn: () => api.get<LessonJournalDto>(`/lesson-sessions/${lessonId}/journal`),
  });
  const action = useAction();
  const [criterionId, setCriterionId] = useState("");
  const [bulkPoints, setBulkPoints] = useState("");

  const score = (studentId: string, points: string) =>
    action.run(
      () =>
        api.post("/scores", {
          idempotencyKey: crypto.randomUUID(),
          lessonSessionId: lessonId,
          studentId,
          points,
          criterionId: criterionId || null,
        }),
      ["journal", "gradebook"],
    );
  const reverse = (entry: ScoreEntryDto) =>
    action.run(
      () => api.post(`/scores/${entry.id}/reverse`, { idempotencyKey: crypto.randomUUID() }),
      ["journal", "gradebook"],
    );
  const mark = (marks: { studentId: string; status: AttendanceStatusCode }[]) =>
    action.run(() => api.put(`/lesson-sessions/${lessonId}/attendance`, { marks }), ["journal", "gradebook"]);
  const scoreEveryone = async (j: LessonJournalDto) => {
    const present = j.students.filter((s) => !s.attendance?.startsWith("ABSENT"));
    const results = await api.post<{ ok: boolean }[]>("/scores", {
      entries: present.map((s) => ({
        idempotencyKey: crypto.randomUUID(),
        lessonSessionId: lessonId,
        studentId: s.studentId,
        points: bulkPoints,
        criterionId: criterionId || null,
      })),
    });
    await journal.refetch();
    const refused = results.filter((r) => !r.ok).length;
    toast(refused ? "error" : "success", refused ? t("bulkRefused", { count: refused }) : t("bulkDone"));
  };

  return (
    <QueryBoundary query={journal}>
      {(j) => {
        const writable = j.locked === null;
        const max = Number(j.maxPoints);
        const quick = Array.from({ length: Math.min(max, 5) }, (_, i) => String(i + 1));
        if (max > 5) quick.push(j.maxPoints);
        return (
          <>
            <PageHeader
              title={`${j.subjectName} · ${j.teachingGroupName}`}
              subtitle={`${j.date} · ${j.topicTitle ?? t("noTopic")} · ${t("lessonMax", { max: j.maxPoints })}`}
              back={
                <Link
                  href={back}
                  className="mb-1 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                  {t("back")}
                </Link>
              }
            />
            {j.locked && (
              <div
                role="status"
                className="mb-4 rounded-card border border-warning bg-warning-soft p-3 text-sm text-warning"
              >
                {t(`locked.${j.locked}`)}
              </div>
            )}
            {writable && (
              <Card className="mb-4">
                <Toolbar>
                  <Select
                    aria-label={t("criterion")}
                    value={criterionId}
                    onChange={(e) => setCriterionId(e.target.value)}
                    className="sm:w-56"
                  >
                    <option value="">{t("noCriterion")}</option>
                    {j.criteria.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="secondary"
                    disabled={action.busy}
                    onClick={() =>
                      void mark(
                        j.students
                          .filter((s) => !s.attendance)
                          .map((s) => ({ studentId: s.studentId, status: "PRESENT" })),
                      )
                    }
                    data-testid="all-present"
                  >
                    <UsersRound className="size-4" aria-hidden />
                    {t("allPresent")}
                  </Button>
                  <span className="flex items-center gap-2">
                    <Input
                      aria-label={t("bulkPoints")}
                      inputMode="decimal"
                      value={bulkPoints}
                      onChange={(e) => setBulkPoints(e.target.value)}
                      className="w-20"
                      placeholder={t("pointsShort")}
                    />
                    <Button
                      variant="secondary"
                      disabled={!bulkPoints || action.busy}
                      onClick={() => void action.run(() => scoreEveryone(j), [])}
                      className="whitespace-nowrap"
                      data-testid="score-everyone"
                    >
                      {t("scoreEveryone")}
                    </Button>
                  </span>
                </Toolbar>
              </Card>
            )}
            {j.students.length === 0 ? (
              <Card>
                <EmptyState text={t("noStudents")} />
              </Card>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="journal">
                {j.students.map((s) => (
                  <li
                    key={s.studentId}
                    className="rounded-card border border-border bg-surface p-3"
                    data-student={s.studentId}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="tabular text-sm text-muted">
                        <span className="font-semibold text-foreground" data-testid="lesson-points">
                          {s.lessonPoints}
                        </span>
                        {` / ${j.maxPoints} · ${t("leftToday", { n: s.remainingToday })}`}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("attendance")}>
                      {ATTENDANCE.map((status) => (
                        <button
                          key={status}
                          type="button"
                          disabled={!writable || action.busy}
                          aria-pressed={s.attendance === status}
                          onClick={() => void mark([{ studentId: s.studentId, status }])}
                          className={cn(
                            "h-9 rounded-button border px-3 text-sm disabled:opacity-60",
                            s.attendance === status
                              ? ATTENDANCE_TONE[status]
                              : "border-border text-muted hover:bg-surface-muted",
                          )}
                        >
                          {t(`attendanceShort.${status}`)}
                        </button>
                      ))}
                    </div>
                    {writable && !s.attendance?.startsWith("ABSENT") && (
                      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("points")}>
                        {quick.map((p) => (
                          <Button
                            key={p}
                            size="lg"
                            variant="secondary"
                            className="min-w-12"
                            disabled={action.busy || Number(p) > Number(s.remainingLesson)}
                            onClick={() => void score(s.studentId, p)}
                            data-points={p}
                          >
                            {`+${p}`}
                          </Button>
                        ))}
                      </div>
                    )}
                    {s.entries.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1" aria-label={t("entries")}>
                        {s.entries
                          .filter((e) => e.kind === "NORMAL")
                          .map((e) => (
                            <li
                              key={e.id}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-button border border-border px-2 py-1 text-xs",
                                e.reversed && "line-through opacity-60",
                              )}
                            >
                              <span className="tabular font-semibold">{`+${e.points}`}</span>
                              {e.criterionName && <span className="text-muted">{e.criterionName}</span>}
                              {writable && !e.reversed && (
                                <button
                                  type="button"
                                  aria-label={t("reverse")}
                                  title={t("reverse")}
                                  disabled={action.busy}
                                  onClick={() => void reverse(e)}
                                  className="text-muted hover:text-danger"
                                >
                                  <Undo2 className="size-3.5" aria-hidden />
                                </button>
                              )}
                            </li>
                          ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        );
      }}
    </QueryBoundary>
  );
}

/** "Jurnal" link of a lesson (teacher or school screens). */
export function JournalLink({ lessonId, base = "/teacher/journal" }: { lessonId: string; base?: string }) {
  const t = useTranslations("scores");
  const me = useMe();
  if (!can(me.data, "gradebook.view")) return null;
  return (
    <Link
      href={`${base}/${lessonId}`}
      className="inline-flex h-8 items-center rounded-button border border-border px-3 text-sm font-medium hover:bg-surface-muted"
      data-testid="journal-link"
    >
      {t("journal")}
    </Link>
  );
}

// ---------------------------------------------------------------- gradebook grid

const STATE_MARK: Record<string, string> = {
  PENDING: "·",
  UPCOMING: "",
  ABSENT_EXCUSED: "Sb",
  ABSENT_UNEXCUSED: "Ss",
  CANCELLED: "×",
};

export function GradebookPage({ journalBase = "/teacher/journal" }: { journalBase?: string }) {
  const t = useTranslations("scores");
  const api = useApi();
  const pathname = usePathname();
  const year = useActiveYear();
  const me = useMe();
  const assignments = useQuery({
    queryKey: ["teacher-assignments", "gradebook", year.data?.id],
    queryFn: () =>
      api
        .get<Page<TeacherAssignmentDto>>(`/teacher-assignments?pageSize=100&academicYearId=${year.data!.id}`)
        .then((p) => p.items),
    enabled: !!year.data,
  });
  const periods = useQuery({
    queryKey: ["periods", year.data?.id],
    queryFn: () => api.get<AcademicPeriodDto[]>(`/academic-years/${year.data!.id}/periods`),
    enabled: !!year.data,
  });
  const today = schoolToday();
  // The choice lives in the URL, so coming back from a lesson journal keeps it.
  const list = useListState(["pair", "period"]);
  const pair = list.filters.pair;
  const periodId = list.filters.period;
  const setPair = (v: string) => list.update({ pair: v });
  const setPeriodId = (v: string) => list.update({ period: v });
  const back = `?back=${encodeURIComponent(`${pathname}?pair=${pair || ""}&period=${periodId || ""}`)}`;
  const options = [
    ...new Map(
      (assignments.data ?? []).map((a) => [
        `${a.teachingGroupId}|${a.subjectId}`,
        { value: `${a.teachingGroupId}|${a.subjectId}`, label: `${a.teachingGroupName} · ${a.subjectName}` },
      ]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
  const chosenPair = pair || options[0]?.value || "";
  const current = (periods.data ?? [])
    .filter((p) => p.startDate <= today && today <= p.endDate)
    .sort((a, b) => (a.endDate < b.endDate ? -1 : 1))[0];
  const chosenPeriod = periodId || current?.id || periods.data?.[0]?.id || "";
  const [groupId, subjectId] = chosenPair.split("|");
  const book = useQuery({
    queryKey: ["gradebook", chosenPair, chosenPeriod],
    queryFn: () =>
      api.get<GradebookDto>(`/gradebook?teachingGroupId=${groupId}&subjectId=${subjectId}&periodId=${chosenPeriod}`),
    enabled: !!groupId && !!chosenPeriod,
  });
  return (
    <>
      <PageHeader title={t("gradebook")} />
      <Card>
        <Toolbar>
          <Select
            aria-label={t("groupSubject")}
            value={chosenPair}
            onChange={(e) => setPair(e.target.value)}
            className="sm:w-72"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("period")}
            value={chosenPeriod}
            onChange={(e) => setPeriodId(e.target.value)}
            className="sm:w-56"
          >
            {(periods.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Toolbar>
        {!chosenPair || !chosenPeriod ? (
          <QueryBoundary query={assignments}>{() => <EmptyState text={t("chooseGroup")} />}</QueryBoundary>
        ) : (
          <QueryBoundary
            query={book}
            isEmpty={(b) => b.students.length === 0 || b.sessions.length === 0}
            empty={<EmptyState text={t("noLessonsInPeriod")} />}
          >
            {(b) => (
              <GradebookGrid
                book={b}
                lessonHref={(id) => `${journalBase}/${id}${back}`}
                canScore={can(me.data, "scores.create") && b.periodStatus !== "CLOSED"}
              />
            )}
          </QueryBoundary>
        )}
      </Card>
      {book.data && book.data.manualComponents.length > 0 && (
        <ManualScores
          book={book.data}
          query={{ periodId: chosenPeriod, teachingGroupId: groupId!, subjectId: subjectId! }}
          canEdit={can(me.data, "assessment.manual_entry") && book.data.periodStatus !== "CLOSED"}
        />
      )}
    </>
  );
}

const MOVES: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/**
 * Lessons × students. Keyboard: arrows move between cells; digits then Enter add that many points to the lesson
 * (the same POST /scores as the journal, so limits apply); Enter on its own or a double click opens the lesson journal.
 */
function GradebookGrid({
  book,
  lessonHref,
  canScore,
}: {
  book: GradebookDto;
  lessonHref: (sessionId: string) => string;
  canScore: boolean;
}) {
  const t = useTranslations("scores");
  const api = useApi();
  const router = useRouter();
  const action = useAction();
  const table = useRef<HTMLTableElement>(null);
  const [active, setActive] = useState("0:0");
  const [typed, setTyped] = useState<{ at: string; value: string } | null>(null);
  const focusCell = (r: number, c: number) =>
    table.current?.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`)?.focus();

  const onKey = (e: KeyboardEvent<HTMLElement>, r: number, c: number, studentId: string, sessionId: string) => {
    const at = `${r}:${c}`;
    const move = MOVES[e.key];
    if (move) {
      e.preventDefault();
      setTyped(null);
      focusCell(r + move[0], c + move[1]);
    } else if (canScore && /^[0-9]$/.test(e.key)) {
      e.preventDefault();
      setTyped((prev) => ({ at, value: `${prev?.at === at ? prev.value : ""}${e.key}`.slice(-3) }));
    } else if (e.key === "Backspace" && typed?.at === at) {
      e.preventDefault();
      setTyped(typed.value.length > 1 ? { at, value: typed.value.slice(0, -1) } : null);
    } else if (e.key === "Escape") {
      setTyped(null);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const points = typed?.at === at ? Number(typed.value) : 0;
      setTyped(null);
      if (points <= 0) return router.push(lessonHref(sessionId));
      void action
        .run(
          () =>
            api.post("/scores", {
              idempotencyKey: crypto.randomUUID(),
              lessonSessionId: sessionId,
              studentId,
              points: String(points),
            }),
          ["gradebook", "journal"],
        )
        .then((ok) => ok && focusCell(r + 1, c));
    }
  };

  return (
    <div className="overflow-x-auto" data-testid="gradebook">
      <table ref={table} className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-surface p-2 text-left font-semibold">
              {t("student")}
            </th>
            {book.sessions.map((s) => (
              <th key={s.id} scope="col" className="p-1 text-center font-normal text-muted" title={s.topicTitle ?? ""}>
                <Link href={lessonHref(s.id)} className="tabular block rounded px-1 hover:bg-surface-muted">
                  {s.date.slice(5).split("-").reverse().join(".")}
                </Link>
              </th>
            ))}
            <th scope="col" className="p-2 text-right font-semibold">
              %
            </th>
          </tr>
        </thead>
        <tbody>
          {book.students.map((st, r) => (
            <tr key={st.studentId} className="border-t border-border" data-student={st.studentId}>
              <th scope="row" className="sticky left-0 z-10 bg-surface p-2 text-left font-medium whitespace-nowrap">
                {st.name}
              </th>
              {book.sessions.map((s, c) => {
                const cell = st.cells.find((x) => x.sessionId === s.id);
                const at = `${r}:${c}`;
                const pending = typed?.at === at;
                return (
                  <td key={s.id} className="p-0 text-center">
                    <button
                      type="button"
                      data-cell={at}
                      tabIndex={active === at ? 0 : -1}
                      onFocus={() => setActive(at)}
                      onBlur={() => pending && setTyped(null)}
                      onKeyDown={(e) => onKey(e, r, c, st.studentId, s.id)}
                      onClick={canScore ? undefined : () => router.push(lessonHref(s.id))}
                      onDoubleClick={() => router.push(lessonHref(s.id))}
                      aria-label={`${st.name}, ${s.date}`}
                      aria-busy={action.busy && active === at}
                      className={cn(
                        "tabular block w-full min-w-9 px-1 py-2 hover:bg-surface-muted focus:bg-primary-soft focus:outline-2 focus:outline-primary",
                        cell?.state === "ABSENT_UNEXCUSED" && "text-danger",
                        cell?.state === "PENDING" && "text-disabled",
                        pending && "font-semibold text-primary",
                      )}
                    >
                      {pending ? `+${typed.value}` : cell ? (cell.points ?? STATE_MARK[cell.state] ?? "") : ""}
                    </button>
                  </td>
                );
              })}
              <td className="tabular p-2 text-right font-semibold" data-testid="row-percent">
                {st.displayPercent ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="p-3 text-xs text-muted">
        {t("legend")} {canScore ? t("legendQuick") : t("legendOpen")}
      </p>
    </div>
  );
}

/** MANUAL components (oral, project, ...) and a higher period's final control, entered per student (Q-12). */
function ManualScores({
  book,
  query,
  canEdit,
}: {
  book: GradebookDto;
  query: { periodId: string; teachingGroupId: string; subjectId: string };
  canEdit: boolean;
}) {
  const t = useTranslations("scores");
  const api = useApi();
  const toast = useToast();
  const action = useAction();
  const params = new URLSearchParams(query).toString();
  const scores = useQuery({
    queryKey: ["manual-scores", params],
    queryFn: () => api.get<ManualScoreDto[]>(`/manual-scores?${params}`),
  });
  const save = (studentId: string, comp: GradebookDto["manualComponents"][number], value: string) => {
    if (!/^\d{1,6}(\.\d{1,4})?$/.test(value) || Number(value) > Number(comp.maxPoints)) {
      toast("error", t("manualInvalid", { max: comp.maxPoints }));
      return;
    }
    void action.run(
      () =>
        api.put("/manual-scores", {
          periodId: query.periodId,
          subjectId: query.subjectId,
          studentId,
          componentKey: comp.key,
          points: value,
          maxPoints: comp.maxPoints,
        }),
      ["manual-scores", "gradebook"],
    );
  };
  return (
    <Card className="mt-4">
      <CardHeader title={t("manualTitle")} />
      <QueryBoundary query={scores}>
        {(list) => (
          <div className="overflow-x-auto" data-testid="manual-scores">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className="p-2 text-left font-semibold">
                    {t("student")}
                  </th>
                  {book.manualComponents.map((comp) => (
                    <th key={comp.key} scope="col" className="p-2 text-left font-semibold">
                      {`${comp.name ?? t("finalControl")} / ${comp.maxPoints}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {book.students.map((st) => (
                  <tr key={st.studentId} className="border-t border-border">
                    <th scope="row" className="p-2 text-left font-medium whitespace-nowrap">
                      {st.name}
                    </th>
                    {book.manualComponents.map((comp) => {
                      const current = list.find((m) => m.studentId === st.studentId && m.componentKey === comp.key);
                      return (
                        <td key={comp.key} className="p-1">
                          {canEdit ? (
                            <Input
                              key={current?.id ?? "none"}
                              aria-label={`${st.name}, ${comp.name ?? t("finalControl")}`}
                              inputMode="decimal"
                              className="w-24"
                              defaultValue={current?.points ?? ""}
                              disabled={action.busy}
                              onBlur={(e) => {
                                const value = e.target.value.trim();
                                if (value !== "" && value !== (current?.points ?? "")) save(st.studentId, comp, value);
                              }}
                              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                            />
                          ) : (
                            <span className="tabular">{current?.points ?? "—"}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="p-3 text-xs text-muted">{canEdit ? t("manualHint") : t("manualReadOnly")}</p>
          </div>
        )}
      </QueryBoundary>
    </Card>
  );
}

// ---------------------------------------------------------------- student / guardian progress

function shiftDate(view: ProgressView, date: SchoolDate, step: -1 | 1): SchoolDate {
  if (view === "DAY") return addSchoolDays(date, step);
  if (view === "WEEK") return addSchoolDays(date, 7 * step);
  const { from, to } = monthRange(date);
  return step < 0 ? addSchoolDays(from, -1) : addSchoolDays(to, 1);
}

export function StudentProgress({ studentId }: { studentId: string }) {
  const t = useTranslations("scores");
  const api = useApi();
  const [view, setView] = useState<ProgressView>("WEEK");
  const [date, setDate] = useState<SchoolDate>(() => schoolToday());
  const progress = useQuery({
    queryKey: ["progress", studentId, view, date],
    queryFn: () => api.get<StudentProgressDto>(`/students/${studentId}/progress?view=${view}&date=${date}`),
    enabled: !!studentId,
  });
  const views = progress.data?.enabledViews ?? ["DAY", "WEEK", "MONTH", "PERIOD"];
  return (
    <div className="flex flex-col gap-4" data-testid="progress">
      <Tabs tabs={views.map((v) => ({ value: v, label: t(`views.${v}`) }))} value={view} onChange={setView} />
      {view !== "PERIOD" && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" aria-label={t("prev")} onClick={() => setDate(shiftDate(view, date, -1))}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <span className="tabular text-sm font-medium">
            {progress.data ? `${progress.data.from} — ${progress.data.to}` : date}
          </span>
          <Button size="sm" variant="ghost" aria-label={t("next")} onClick={() => setDate(shiftDate(view, date, 1))}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      )}
      <QueryBoundary query={progress}>
        {(p) => {
          const results = new Map(p.periodResults.filter((r) => r.subjectId).map((r) => [r.subjectId, r]));
          const overallResult = p.periodResults.find((r) => !r.subjectId);
          return (
            <>
              {view === "PERIOD" && p.periodName && <p className="text-sm text-muted">{p.periodName}</p>}
              {p.overall && (
                <Card className="flex items-center gap-4 p-4" data-testid="overall">
                  <ProgressRing percent={Number(p.overall.percent ?? 0)} label={t("overall")} />
                  <div>
                    <p className="text-sm text-muted">{t("overall")}</p>
                    <p className="tabular text-2xl font-bold">
                      {p.overall.displayPercent === null ? "—" : `${p.overall.displayPercent}%`}
                      {overallResult?.gradeLabel ? ` · ${overallResult.gradeLabel}` : ""}
                    </p>
                  </div>
                </Card>
              )}
              {p.series.length > 1 && <SeriesBars series={p.series} />}
              {p.subjects.length === 0 ? (
                <Card>
                  <EmptyState text={t("noScores")} />
                </Card>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2" data-testid="subjects">
                  {[...p.subjects]
                    // Subjects with scores first (the API sorts by name).
                    .sort((a, b) => Number(a.percent === null) - Number(b.percent === null))
                    .map((s) => {
                      const r = results.get(s.subjectId);
                      return (
                        <li
                          key={s.subjectId}
                          className="flex items-center gap-3 rounded-card border border-border bg-surface p-3"
                        >
                          <ProgressRing percent={Number(s.percent ?? 0)} size={48} label={s.subjectName} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{s.subjectName}</p>
                            <p className="text-xs text-muted">
                              {t("sessionsLine", { scored: s.scoredSessions, pending: s.pendingSessions })}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="tabular text-lg font-bold" data-testid="subject-percent">
                              {s.displayPercent === null ? "—" : `${s.displayPercent}%`}
                            </p>
                            {r && (
                              <p className="tabular text-xs text-muted">
                                {r.totalPoints === null
                                  ? t("incomplete")
                                  : t("periodPoints", { points: r.displayPercent ?? "—", max: 100 })}
                                {r.gradeLabel ? ` · ${r.gradeLabel}` : ""}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                </ul>
              )}
              <Card>
                <CardHeader title={t("history")} />
                {p.entries.length === 0 ? (
                  <EmptyState text={t("noScores")} />
                ) : (
                  <ul className="divide-y divide-border">
                    {p.entries.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block font-medium">{e.subjectName}</span>
                          <span className="block truncate text-xs text-muted">
                            {[e.schoolDate, e.topicTitle, e.criterionName].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <Badge tone={e.kind === "REVERSAL" ? "danger" : "success"}>
                          {e.kind === "REVERSAL" ? e.points : `+${e.points}`}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          );
        }}
      </QueryBoundary>
    </div>
  );
}

/** Day by day percent as plain bars (no chart library needed). */
function SeriesBars({ series }: { series: StudentProgressDto["series"] }) {
  const t = useTranslations("scores");
  return (
    <Card className="p-4">
      <p className="mb-2 text-sm text-muted">{t("byDay")}</p>
      <div className="flex h-28 items-end gap-1" role="img" aria-label={t("byDay")}>
        {series.map((d) => (
          <div
            key={d.date}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${d.date}: ${d.percent ?? "—"}`}
          >
            <div
              className={cn("rounded-t", d.percent === null ? "h-1 bg-surface-muted" : "bg-primary")}
              style={d.percent === null ? undefined : { height: `${Math.max(4, Number(d.percent))}%` }}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function PortalProgressPage() {
  const t = useTranslations("scores");
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
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-foreground">{t("progress")}</h1>
      {guardian && (children.data?.length ?? 0) > 1 && (
        <Select aria-label={t("child")} value={studentId} onChange={(e) => setChildId(e.target.value)}>
          {(children.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>{`${c.lastName} ${c.firstName}`}</option>
          ))}
        </Select>
      )}
      {studentId ? (
        <StudentProgress studentId={studentId} />
      ) : guardian ? (
        <QueryBoundary query={children}>{() => <EmptyState text={t("noChild")} />}</QueryBoundary>
      ) : (
        <EmptyState text={t("noChild")} />
      )}
    </div>
  );
}

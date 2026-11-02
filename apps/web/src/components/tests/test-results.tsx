"use client";

// Published test views (tests.md §5, §6, §8): results and statistics, question analysis, attempts (reopen, retake
// windows) and the offline results grid (with paste from Excel).
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ClipboardEvent, type FormEvent } from "react";
import type { OfflineResultsDto, QuestionStatsDto, TestAttemptDto, TestDetailDto, TestStatsDto } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stats";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";
import { formatInstant, fromLocalInput, pct, toLocalInput } from "./common";

const withPct = (v: string | null) => (v === null ? "—" : `${pct(v)}%`);

const REASON_TONE = { SUBMITTED: "success", TIME_UP: "warning", VIOLATION: "danger", ADMIN_CLOSED: "neutral" } as const;

function useStats(testId: string) {
  const api = useApi();
  return useQuery({ queryKey: ["test-stats", testId], queryFn: () => api.get<TestStatsDto>(`/tests/${testId}/stats`) });
}

export function ResultsTab({ test }: { test: TestDetailDto }) {
  const t = useTranslations("tests");
  const stats = useStats(test.id);
  return (
    <QueryBoundary query={stats}>
      {(s) => (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="test-summary">
            <StatCard label={t("stats.participants")} value={`${s.participants} / ${s.assigned}`} />
            <StatCard label={t("stats.mean")} value={withPct(s.summary.mean)} />
            <StatCard label={t("stats.median")} value={withPct(s.summary.median)} />
            <StatCard
              label={t("stats.range")}
              value={s.summary.min === null ? "—" : `${pct(s.summary.min)} – ${withPct(s.summary.max)}`}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t("stats.distribution")} />
              <Histogram values={s.summary.histogram} />
            </Card>
            <Card>
              <CardHeader title={t("stats.breakdown")} />
              <div className="flex flex-col gap-3 p-4 text-sm">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(s.finishReasons).map(([k, n]) => (
                    <Badge key={k} tone={k in REASON_TONE ? REASON_TONE[k as keyof typeof REASON_TONE] : "neutral"}>
                      {`${t(`reasons.${k}`)}: ${n}`}
                    </Badge>
                  ))}
                </div>
                {s.groups.length > 1 &&
                  s.groups.map((g) => (
                    <p key={g.teachingGroupId}>
                      {t("stats.groupMean", { group: g.name, mean: pct(g.mean), n: g.count })}
                    </p>
                  ))}
                {s.previous && (
                  <p className="text-muted">
                    {t("stats.previous", { title: s.previous.title, mean: pct(s.previous.mean) })}
                  </p>
                )}
              </div>
            </Card>
          </div>
          <Card>
            <CardHeader title={t("stats.students")} />
            {s.students.length === 0 ? (
              <EmptyState text={t("stats.noStudents")} />
            ) : (
              <DataTable
                testId="test-students"
                rows={s.students.map((x) => ({ ...x, id: x.studentId }))}
                columns={[
                  { key: "name", header: t("student"), primary: true, cell: (x) => x.studentName },
                  {
                    key: "score",
                    header: t("score"),
                    cell: (x) => (x.score === null ? "—" : `${pct(x.score)} / ${pct(x.maxScore)}`),
                  },
                  {
                    key: "percent",
                    header: "%",
                    cell: (x) => <span className="tabular font-semibold">{pct(x.percent)}</span>,
                  },
                  {
                    key: "attempts",
                    header: t("attemptsCount"),
                    cell: (x) => (test.format === "ONLINE" ? x.attempts : "—"),
                  },
                  {
                    key: "state",
                    header: t("statusLabel"),
                    cell: (x) =>
                      x.finishReason || x.offlineStatus ? (
                        <Badge
                          tone={x.finishReason ? REASON_TONE[x.finishReason as keyof typeof REASON_TONE] : "neutral"}
                        >
                          {x.finishReason ? t(`reasons.${x.finishReason}`) : t(`offline.${x.offlineStatus}`)}
                        </Badge>
                      ) : (
                        <span className="text-muted">{t("noResult")}</span>
                      ),
                  },
                ]}
              />
            )}
          </Card>
        </div>
      )}
    </QueryBoundary>
  );
}

function Histogram({ values }: { values: number[] }) {
  const t = useTranslations("tests");
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-40 items-end gap-1 p-4" role="img" aria-label={t("stats.distribution")}>
      {values.map((n, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-xs text-muted">{n || ""}</span>
          <div
            className="w-full rounded-t bg-primary"
            style={{ height: `${(n / max) * 100}%`, minHeight: n ? 4 : 0 }}
          />
          <span className="text-[10px] text-muted">{i * 10}</span>
        </div>
      ))}
    </div>
  );
}

export function QuestionStatsTab({ testId }: { testId: string }) {
  const t = useTranslations("tests");
  const api = useApi();
  const stats = useQuery({
    queryKey: ["question-stats", testId],
    queryFn: () => api.get<QuestionStatsDto[]>(`/tests/${testId}/questions-stats`),
  });
  return (
    <QueryBoundary query={stats} isEmpty={(l) => l.length === 0}>
      {(list) => (
        <ol className="flex flex-col gap-3" data-testid="question-stats">
          {list.map((q) => (
            <Card key={q.testQuestionId} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium">{`${q.order + 1}. ${q.text}`}</p>
                <Badge tone={Number(q.correctPercent ?? 0) >= 50 ? "success" : "danger"}>
                  {t("stats.correct", { p: pct(q.correctPercent) })}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted">
                {[t(`questionType.${q.type}`), q.topicTitle, t("stats.answered", { n: q.answered, of: q.shown })]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {q.options.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1">
                  {q.options.map((o) => (
                    <li key={o.id} className="grid grid-cols-[1fr_4rem] items-center gap-2 text-sm">
                      <div className="relative overflow-hidden rounded bg-surface-muted px-2 py-1">
                        <div
                          className={
                            o.isCorrect
                              ? "absolute inset-y-0 left-0 bg-success-soft"
                              : "absolute inset-y-0 left-0 bg-danger-soft"
                          }
                          style={{ width: `${Number(o.share ?? 0)}%` }}
                        />
                        <span className="relative">{`${o.id.toUpperCase()}. ${o.text}`}</span>
                      </div>
                      <span className="tabular text-right">{`${pct(o.share)}%`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </ol>
      )}
    </QueryBoundary>
  );
}

// ---------------------------------------------------------------- attempts, reopen, retake windows

export function AttemptsTab({ test }: { test: TestDetailDto }) {
  const t = useTranslations("tests");
  const api = useApi();
  const locale = useLocale();
  const me = useMe();
  const reopenAllowed = can(me.data, "tests.reopen");
  const attempts = useQuery({
    queryKey: ["test-attempts", test.id],
    queryFn: () => api.get<TestAttemptDto[]>(`/tests/${test.id}/attempts`),
    refetchInterval: 15_000,
  });
  const [reopening, setReopening] = useState<TestAttemptDto | null>(null);
  const [retake, setRetake] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={t("attempts.title")}
          action={
            reopenAllowed && (
              <Button size="sm" variant="secondary" onClick={() => setRetake(true)}>
                {t("attempts.giveRetake")}
              </Button>
            )
          }
        />
        <QueryBoundary
          query={attempts}
          isEmpty={(l) => l.length === 0}
          empty={<EmptyState text={t("attempts.empty")} />}
        >
          {(list) => (
            <DataTable
              testId="attempts"
              rows={list}
              columns={[
                { key: "name", header: t("student"), primary: true, cell: (a) => `${a.studentName} · ${a.attemptNo}` },
                { key: "started", header: t("attempts.started"), cell: (a) => formatInstant(a.startedAt, locale) },
                {
                  key: "state",
                  header: t("statusLabel"),
                  cell: (a) =>
                    a.status === "IN_PROGRESS" ? (
                      <Badge tone="primary">
                        {t("attempts.running", { until: formatInstant(a.deadline, locale) })}
                      </Badge>
                    ) : (
                      <Badge tone={REASON_TONE[a.finishReason!]}>{t(`reasons.${a.finishReason}`)}</Badge>
                    ),
                },
                { key: "violations", header: t("attempts.violations"), cell: (a) => a.violationCount },
                { key: "percent", header: "%", cell: (a) => pct(a.percent) },
                {
                  key: "actions",
                  header: "",
                  cell: (a) =>
                    reopenAllowed &&
                    a.status === "FINISHED" && (
                      <Button size="sm" variant="ghost" onClick={() => setReopening(a)}>
                        {t("attempts.reopen")}
                      </Button>
                    ),
                },
              ]}
            />
          )}
        </QueryBoundary>
      </Card>
      <Overrides testId={test.id} />
      {reopening && <ReopenDialog attempt={reopening} onClose={() => setReopening(null)} />}
      {retake && <RetakeDialog test={test} onClose={() => setRetake(false)} />}
    </div>
  );
}

function Overrides({ testId }: { testId: string }) {
  const t = useTranslations("tests");
  const api = useApi();
  const locale = useLocale();
  const overrides = useQuery({
    queryKey: ["test-overrides", testId],
    queryFn: () =>
      api.get<
        {
          id: string;
          studentName: string;
          startsAt: string;
          endsAt: string;
          reason: string;
          timeLimitMinutes: number | null;
        }[]
      >(`/tests/${testId}/overrides`),
  });
  return (
    <Card>
      <CardHeader title={t("attempts.overrides")} />
      <QueryBoundary
        query={overrides}
        isEmpty={(l) => l.length === 0}
        empty={<EmptyState text={t("attempts.noOverrides")} />}
      >
        {(list) => (
          <ul className="divide-y divide-border">
            {list.map((o) => (
              <li key={o.id} className="px-4 py-2 text-sm">
                <span className="font-medium">{o.studentName}</span>
                {` · ${formatInstant(o.startsAt, locale)} – ${formatInstant(o.endsAt, locale)}`}
                {o.timeLimitMinutes ? ` · ${t("minutes", { n: o.timeLimitMinutes })}` : ""}
                <span className="block text-muted">{o.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </Card>
  );
}

function ReopenDialog({ attempt, onClose }: { attempt: TestAttemptDto; onClose: () => void }) {
  const t = useTranslations("tests");
  const api = useApi();
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("10");
  const save = useSave(
    () => api.post(`/attempts/${attempt.id}/reopen`, { reason, minutes: Number(minutes) }),
    ["test-attempts", "test-stats"],
    onClose,
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={t("attempts.reopenTitle", { name: attempt.studentName })}
      footer={
        <Button type="submit" form="reopen-form" loading={save.isPending}>
          {t("attempts.reopen")}
        </Button>
      }
    >
      <form
        id="reopen-form"
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <p className="text-sm text-muted">{t("attempts.reopenHint")}</p>
        <Field label={t("attempts.minutes")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={600}
              required
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("reason")}>
          {(id) => <Input id={id} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </form>
    </Modal>
  );
}

function RetakeDialog({ test, onClose }: { test: TestDetailDto; onClose: () => void }) {
  const t = useTranslations("tests");
  const api = useApi();
  const stats = useStats(test.id);
  const [students, setStudents] = useState<string[]>([]);
  const now = new Date().toISOString();
  const [startsAt, setStartsAt] = useState(toLocalInput(now));
  const [endsAt, setEndsAt] = useState("");
  const [limit, setLimit] = useState(test.timeLimitMinutes ? String(test.timeLimitMinutes) : "");
  const [reason, setReason] = useState("");
  const save = useSave(
    () =>
      api.post(`/tests/${test.id}/overrides`, {
        studentIds: students,
        startsAt: fromLocalInput(startsAt),
        endsAt: fromLocalInput(endsAt),
        timeLimitMinutes: limit ? Number(limit) : null,
        reason,
      }),
    ["test-overrides", "test-attempts"],
    onClose,
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={t("attempts.giveRetake")}
      footer={
        <Button type="submit" form="retake-form" loading={save.isPending} disabled={!students.length}>
          {t("attempts.giveRetake")}
        </Button>
      }
    >
      <form
        id="retake-form"
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <fieldset className="max-h-48 overflow-y-auto">
          <legend className="mb-1 text-sm font-medium">{t("attempts.students")}</legend>
          {(stats.data?.students ?? []).map((s) => (
            <label key={s.studentId} className="flex items-center gap-2 py-0.5 text-sm">
              <input
                type="checkbox"
                checked={students.includes(s.studentId)}
                onChange={(e) =>
                  setStudents(e.target.checked ? [...students, s.studentId] : students.filter((x) => x !== s.studentId))
                }
              />
              {s.studentName}
              {s.percent !== null && <span className="text-muted">{`${pct(s.percent)}%`}</span>}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("startsAt")}>
            {(id) => (
              <Input
                id={id}
                type="datetime-local"
                required
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            )}
          </Field>
          <Field label={t("endsAt")}>
            {(id) => (
              <Input
                id={id}
                type="datetime-local"
                required
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t("timeLimit")}>
          {(id) => (
            <Input id={id} type="number" min={1} max={600} value={limit} onChange={(e) => setLimit(e.target.value)} />
          )}
        </Field>
        <Field label={t("reason")}>
          {(id) => <Input id={id} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- offline results (§6)

type Cell = { status: "" | "SCORED" | "ABSENT" | "EXCUSED"; rawScore: string; note: string };

export function OfflineEntry({ test }: { test: TestDetailDto }) {
  const t = useTranslations("tests");
  const api = useApi();
  const results = useQuery({
    queryKey: ["offline-results", test.id],
    queryFn: () => api.get<OfflineResultsDto>(`/tests/${test.id}/offline-results`),
  });
  return (
    <QueryBoundary
      query={results}
      isEmpty={(r) => r.rows.length === 0}
      empty={<EmptyState text={t("entry.noStudents")} />}
    >
      {(r) => <OfflineGrid test={test} data={r} key={results.dataUpdatedAt} />}
    </QueryBoundary>
  );
}

function OfflineGrid({ test, data }: { test: TestDetailDto; data: OfflineResultsDto }) {
  const t = useTranslations("tests");
  const api = useApi();
  const toast = useToast();
  const me = useMe();
  const [cells, setCells] = useState<Record<string, Cell>>(() =>
    Object.fromEntries(
      data.rows.map((r) => [r.studentId, { status: r.status ?? "", rawScore: r.rawScore ?? "", note: r.note ?? "" }]),
    ),
  );
  const [reason, setReason] = useState("");
  const editable = can(me.data, "tests.results.enter") && test.status !== "ARCHIVED";
  const setCell = (id: string, patch: Partial<Cell>) => setCells((c) => ({ ...c, [id]: { ...c[id]!, ...patch } }));
  // A score typed into an empty row means SCORED; clearing it leaves the row empty (not saved).
  const changed = data.rows.filter((r) => {
    const c = cells[r.studentId]!;
    const status = c.status || (c.rawScore ? "SCORED" : "");
    return (
      status &&
      (status !== (r.status ?? "") ||
        (status === "SCORED" && Number(c.rawScore) !== Number(r.rawScore)) ||
        c.note !== (r.note ?? ""))
    );
  });
  const save = useSave(async () => {
    const res = await api.put<OfflineResultsDto>(`/tests/${test.id}/offline-results`, {
      results: changed.map((r) => {
        const c = cells[r.studentId]!;
        const status = c.status || "SCORED";
        return {
          studentId: r.studentId,
          status,
          rawScore: status === "SCORED" ? c.rawScore : null,
          note: c.note || null,
        };
      }),
      ...(reason ? { reason } : {}),
    });
    if (res.missing) toast("success", t("entry.missing", { n: res.missing }));
  }, ["offline-results", "test-stats"]);
  /** Paste a column of scores from Excel into this row and the ones below it. */
  const paste = (e: ClipboardEvent<HTMLInputElement>, from: number) => {
    const lines = e.clipboardData
      .getData("text")
      .split(/\r?\n/)
      .map((l) => l.split("\t")[0]!.trim().replace(",", "."));
    if (lines.length < 2) return;
    e.preventDefault();
    lines.forEach((value, i) => {
      const row = data.rows[from + i];
      if (row && value !== "") setCell(row.studentId, { rawScore: value, status: "SCORED" });
    });
  };
  return (
    <Card>
      <CardHeader title={t("entry.title", { max: data.maxScore })} />
      <p className="px-4 text-sm text-muted">{t("entry.hint")}</p>
      <form onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}>
        <ul className="divide-y divide-border" data-testid="offline-grid">
          {data.rows.map((r, i) => {
            const c = cells[r.studentId]!;
            const over = c.rawScore !== "" && Number(c.rawScore) > Number(data.maxScore);
            return (
              <li
                key={r.studentId}
                className="grid grid-cols-1 gap-2 px-4 py-2 sm:grid-cols-[1fr_9rem_6rem_1fr] sm:items-center"
                data-student={r.studentId}
              >
                <span className="text-sm font-medium">
                  {r.studentName}
                  {r.corrections > 0 && (
                    <span className="ml-2 text-xs text-muted">{t("entry.corrected", { n: r.corrections })}</span>
                  )}
                </span>
                <Select
                  aria-label={t("statusLabel")}
                  disabled={!editable}
                  value={c.status}
                  onChange={(e) => setCell(r.studentId, { status: e.target.value as Cell["status"] })}
                >
                  <option value="">{t("entry.empty")}</option>
                  {(["SCORED", "ABSENT", "EXCUSED"] as const).map((s) => (
                    <option key={s} value={s}>
                      {t(`offline.${s}`)}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={t("score")}
                  inputMode="decimal"
                  disabled={!editable || c.status === "ABSENT" || c.status === "EXCUSED"}
                  invalid={over}
                  value={c.rawScore}
                  onPaste={(e) => paste(e, i)}
                  onChange={(e) => setCell(r.studentId, { rawScore: e.target.value.replace(",", ".") })}
                />
                <Input
                  aria-label={t("note")}
                  placeholder={t("note")}
                  disabled={!editable}
                  value={c.note}
                  onChange={(e) => setCell(r.studentId, { note: e.target.value })}
                />
              </li>
            );
          })}
        </ul>
        {editable && (
          <div className="flex flex-col gap-2 border-t border-border p-4 sm:flex-row sm:items-center">
            {can(me.data, "assessment.reopen") && test.purpose === "WEIGHTED" && (
              <Input
                aria-label={t("entry.reason")}
                placeholder={t("entry.reason")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="sm:max-w-sm"
              />
            )}
            <Button type="submit" loading={save.isPending} disabled={!changed.length}>
              {t("entry.save", { n: changed.length })}
            </Button>
            <span className="text-sm text-muted">{t("entry.missingNow", { n: data.missing })}</span>
          </div>
        )}
      </form>
    </Card>
  );
}

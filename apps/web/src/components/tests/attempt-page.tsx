"use client";

// Taking a test on a phone (tests.md §4.3–§4.5). One question per screen with a navigator; every answer is saved at
// once with an increasing clientSeq (an older save never overwrites a newer one on the server); while offline the
// answers wait in a queue (kept in the browser across a reload) and go out when the connection is back. The timer counts
// from the server's deadline and clock, not the phone's. Leaving the page is reported; the server decides what counts.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, CloudOff, Timer } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerValue, AttemptViewDto } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/modal";
import { QueryBoundary } from "@/components/ui/states";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { AuthImage, pct } from "./common";

type Question = AttemptViewDto["questions"][number];
type Pending = Record<string, { answer: AnswerValue; clientSeq: number }>;

const storeKey = (id: string) => `idrok_attempt_${id}`;
function loadPending(id: string): Pending {
  try {
    return JSON.parse(localStorage.getItem(storeKey(id)) ?? "{}") as Pending;
  } catch {
    return {};
  }
}
function storePending(id: string, p: Pending) {
  try {
    if (Object.keys(p).length) localStorage.setItem(storeKey(id), JSON.stringify(p));
    else localStorage.removeItem(storeKey(id));
  } catch {
    // private mode: the queue lives in memory only
  }
}

const answered = (a: AnswerValue | undefined) =>
  !!a && ("optionIds" in a ? a.optionIds.length > 0 : "text" in a ? a.text.trim() !== "" : a.pairs.length > 0);

export function AttemptPage({ attemptId }: { attemptId: string }) {
  const api = useApi();
  const view = useQuery({
    queryKey: ["attempt", attemptId],
    queryFn: () => api.get<AttemptViewDto>(`/attempts/${attemptId}`),
    refetchOnWindowFocus: false,
  });
  return (
    <QueryBoundary query={view}>
      {(v) => (v.status === "FINISHED" ? <AttemptResult view={v} /> : <Runner view={v} key={v.startedAt} />)}
    </QueryBoundary>
  );
}

function Runner({ view }: { view: AttemptViewDto }) {
  const t = useTranslations("tests.attempt");
  const api = useApi();
  const qc = useQueryClient();
  const total = view.questions.length;
  const [index, setIndex] = useState(Math.min(view.currentIndex, total - 1));
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => {
    const fromServer = Object.fromEntries(Object.entries(view.answers).map(([k, v]) => [k, v.answer]));
    const queued = loadPending(view.id);
    return { ...fromServer, ...Object.fromEntries(Object.entries(queued).map(([k, v]) => [k, v.answer])) };
  });
  const [queued] = useState(() => loadPending(view.id));
  const pending = useRef<Pending>(queued);
  const seq = useRef(
    Math.max(
      0,
      ...Object.values(view.answers).map((a) => a.clientSeq),
      ...Object.values(queued).map((a) => a.clientSeq),
    ),
  );
  const [unsaved, setUnsaved] = useState(Object.keys(queued).length);
  const [offline, setOffline] = useState(false);
  const [warning, setWarning] = useState<{ remaining: number | null } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const flushing = useRef(false);

  const finish = useCallback(() => void qc.invalidateQueries({ queryKey: ["attempt", view.id] }), [qc, view.id]);

  /** Sends the queue; keeps what fails for the network; on a 409 (finished, deadline) shows the result. */
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (const [tqId, item] of Object.entries(pending.current)) {
        try {
          await api.put(`/attempts/${view.id}/answers/${tqId}`, item);
          if (pending.current[tqId]?.clientSeq === item.clientSeq) delete pending.current[tqId];
          setOffline(false);
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            pending.current = {};
            finish();
            break;
          }
          if (err instanceof ApiError && err.status === 400) {
            delete pending.current[tqId]; // a malformed answer would block the queue forever
            continue;
          }
          setOffline(true);
          break;
        }
      }
    } finally {
      storePending(view.id, pending.current);
      setUnsaved(Object.keys(pending.current).length);
      flushing.current = false;
    }
  }, [api, view.id, finish]);

  const answer = (tqId: string, value: AnswerValue) => {
    setAnswers((a) => ({ ...a, [tqId]: value }));
    seq.current += 1;
    pending.current = { ...pending.current, [tqId]: { answer: value, clientSeq: seq.current } };
    storePending(view.id, pending.current);
    setUnsaved(Object.keys(pending.current).length);
    void flush();
  };

  // Retry while offline, and as soon as the browser says it is back.
  useEffect(() => {
    const retry = setInterval(() => Object.keys(pending.current).length && void flush(), 4000);
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => (clearInterval(retry), window.removeEventListener("online", online));
  }, [flush]);

  // The position is remembered on the server (a reload or another device continues here).
  const go = (i: number) => {
    setIndex(i);
    void api.put(`/attempts/${view.id}/position`, { currentIndex: i }).catch(() => undefined);
  };

  // Anti-cheat (§4.4): the page reports, the server counts; a counted violation shows the remaining chances.
  useEffect(() => {
    let reported = 0;
    const send = (type: string) => {
      reported += 1;
      api
        .post<{ counted: boolean; remaining: number | null; finished: boolean }>(`/attempts/${view.id}/events`, {
          type,
          clientTs: new Date().toISOString(),
          clientSeq: reported,
        })
        .then((r) => {
          if (r.finished) finish();
          else if (r.counted) setWarning({ remaining: r.remaining });
        })
        .catch((err: unknown) => err instanceof ApiError && err.status === 409 && finish());
    };
    const visibility = () => send(document.hidden ? "VISIBILITY_HIDDEN" : "VISIBILITY_VISIBLE");
    const blur = () => send("BLUR");
    const focus = () => send("FOCUS");
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
    };
  }, [api, view.id, finish]);

  const submit = async () => {
    setSubmitting(true);
    await flush();
    try {
      await api.post(`/attempts/${view.id}/submit`, {});
    } finally {
      setSubmitting(false);
      setConfirm(false);
      finish();
    }
  };

  const q = view.questions[index]!;
  const unanswered = view.questions.filter((x) => !answered(answers[x.testQuestionId])).length;
  return (
    <div className="flex flex-col gap-3 pb-6" data-testid="attempt">
      <div className="sticky top-14 z-10 -mx-4 flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2">
        <p className="min-w-0 truncate text-sm font-semibold">{view.title}</p>
        <div className="flex items-center gap-2">
          {(offline || unsaved > 0) && (
            <Badge tone={offline ? "danger" : "warning"}>
              <CloudOff className="mr-1 size-3" aria-hidden />
              {t("unsaved", { n: unsaved })}
            </Badge>
          )}
          <Countdown view={view} onExpired={() => void flush().then(finish)} />
        </div>
      </div>
      {warning && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-card border border-danger bg-danger-soft p-3 text-sm text-danger"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {warning.remaining === null ? t("leftWarningNoLimit") : t("leftWarning", { n: warning.remaining })}
          </span>
          <button type="button" className="ml-auto underline" onClick={() => setWarning(null)}>
            {t("ok")}
          </button>
        </div>
      )}
      <nav aria-label={t("navigator")} className="flex flex-wrap gap-1.5" data-testid="navigator">
        {view.questions.map((x, i) => (
          <button
            key={x.testQuestionId}
            type="button"
            aria-current={i === index ? "step" : undefined}
            aria-label={t("goTo", { n: i + 1 })}
            onClick={() => go(i)}
            className={cn(
              "size-9 rounded-button border text-sm font-medium",
              i === index
                ? "border-primary bg-primary text-on-primary"
                : answered(answers[x.testQuestionId])
                  ? "border-primary bg-primary-soft text-primary-strong"
                  : "border-border text-muted",
            )}
          >
            {i + 1}
          </button>
        ))}
      </nav>
      <Card className="flex flex-col gap-4 p-4" data-testid="question">
        <p className="text-xs text-muted">{t("questionOf", { n: index + 1, total, points: pct(q.points) })}</p>
        <p className="whitespace-pre-wrap text-base font-medium">{q.text}</p>
        {q.imageAssetId && (
          <AuthImage
            path={`/attempts/${view.id}/images/${q.imageAssetId}`}
            alt={t("image")}
            className="max-h-64 w-full rounded-card object-contain"
          />
        )}
        <QuestionInput question={q} value={answers[q.testQuestionId]} onChange={(v) => answer(q.testQuestionId, v)} />
      </Card>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" disabled={index === 0} onClick={() => go(index - 1)}>
          <ChevronLeft className="size-5" aria-hidden />
          {t("prev")}
        </Button>
        {index < total - 1 ? (
          <Button variant="secondary" size="lg" onClick={() => go(index + 1)}>
            {t("next")}
            <ChevronRight className="size-5" aria-hidden />
          </Button>
        ) : (
          <Button size="lg" onClick={() => setConfirm(true)} data-testid="finish">
            {t("finish")}
          </Button>
        )}
      </div>
      {index < total - 1 && (
        <Button variant="ghost" onClick={() => setConfirm(true)}>
          {t("finish")}
        </Button>
      )}
      <ConfirmDialog
        open={confirm}
        title={t("confirmTitle")}
        text={unanswered ? t("confirmUnanswered", { n: unanswered }) : t("confirmAll")}
        loading={submitting}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void submit()}
      />
    </div>
  );
}

function QuestionInput({
  question: q,
  value,
  onChange,
}: {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
}) {
  const t = useTranslations("tests.attempt");
  const [text, setText] = useState(value && "text" in value ? value.text : "");
  useEffect(() => {
    if (q.type !== "SHORT_TEXT") return;
    const current = value && "text" in value ? value.text : "";
    if (text === current) return;
    const id = setTimeout(() => onChange({ text }), 600);
    return () => clearTimeout(id);
  }, [text, q.type, value, onChange]);

  if (q.type === "SINGLE" || q.type === "MULTIPLE") {
    const chosen = value && "optionIds" in value ? value.optionIds : [];
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{q.type === "SINGLE" ? t("chooseOne") : t("chooseMany")}</legend>
        {q.type === "MULTIPLE" && <p className="text-xs text-muted">{t("chooseMany")}</p>}
        {q.options!.map((o) => {
          const on = chosen.includes(o.id);
          return (
            <label
              key={o.id}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-card border px-3 py-2 text-sm",
                on ? "border-primary bg-primary-soft" : "border-border",
              )}
            >
              <input
                type={q.type === "SINGLE" ? "radio" : "checkbox"}
                name={q.testQuestionId}
                checked={on}
                onChange={(e) =>
                  onChange({
                    optionIds:
                      q.type === "SINGLE"
                        ? [o.id]
                        : e.target.checked
                          ? [...chosen, o.id]
                          : chosen.filter((x) => x !== o.id),
                  })
                }
                className="size-5"
              />
              {o.text}
            </label>
          );
        })}
      </fieldset>
    );
  }
  if (q.type === "SHORT_TEXT")
    return (
      <Input
        aria-label={t("yourAnswer")}
        placeholder={t("yourAnswer")}
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => (value && "text" in value ? value.text : "") !== text && onChange({ text })}
        className="h-12 text-base"
      />
    );
  const pairs = value && "pairs" in value ? value.pairs : [];
  return (
    <ul className="flex flex-col gap-2">
      {q.leftItems!.map((left) => (
        <li key={left.id} className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:items-center">
          <span className="text-sm font-medium">{left.text}</span>
          <Select
            aria-label={left.text}
            value={pairs.find((p) => p.leftId === left.id)?.rightId ?? ""}
            onChange={(e) =>
              onChange({
                pairs: [
                  ...pairs.filter((p) => p.leftId !== left.id),
                  ...(e.target.value ? [{ leftId: left.id, rightId: e.target.value }] : []),
                ],
              })
            }
          >
            <option value="">{t("choose")}</option>
            {q.rightItems!.map((r) => (
              <option key={r.id} value={r.id}>
                {r.text}
              </option>
            ))}
          </Select>
        </li>
      ))}
    </ul>
  );
}

/** Remaining time from the server's deadline and clock (the phone's own clock may be wrong). */
function Countdown({ view, onExpired }: { view: AttemptViewDto; onExpired: () => void }) {
  const t = useTranslations("tests.attempt");
  const [offset] = useState(() => new Date(view.serverNow).getTime() - Date.now());
  const deadline = view.deadline ? new Date(view.deadline).getTime() : null;
  const [now, setNow] = useState(() => Date.now() + offset);
  const expired = useRef(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(id);
  }, [offset]);
  const left = deadline === null ? null : Math.max(0, Math.floor((deadline - now) / 1000));
  useEffect(() => {
    if (left === 0 && !expired.current) {
      expired.current = true;
      onExpired();
    }
  }, [left, onExpired]);
  if (left === null) return null;
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <span
      role="timer"
      aria-label={t("timeLeft")}
      className={cn(
        "tabular inline-flex items-center gap-1 rounded-button px-2 py-1 text-sm font-semibold",
        left < 60 ? "bg-danger-soft text-danger" : "bg-surface-muted",
      )}
    >
      <Timer className="size-4" aria-hidden />
      {`${mm}:${ss}`}
    </span>
  );
}

function AttemptResult({ view }: { view: AttemptViewDto }) {
  const t = useTranslations("tests.attempt");
  return (
    <div className="flex flex-col gap-4" data-testid="attempt-result">
      <Card className="flex flex-col items-center gap-2 p-6 text-center">
        <p className="text-sm text-muted">{view.title}</p>
        <Badge tone={view.finishReason === "SUBMITTED" ? "success" : "warning"}>
          {t(`finished.${view.finishReason}`)}
        </Badge>
        {view.result ? (
          <>
            <p className="tabular text-4xl font-bold" data-testid="result-percent">{`${pct(view.result.percent)}%`}</p>
            <p className="text-sm text-muted">
              {t("score", { score: pct(view.result.score), max: pct(view.result.maxScore) })}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">{t("resultLater")}</p>
        )}
      </Card>
      {view.perQuestion && (
        <Card className="p-4">
          <p className="mb-2 text-sm font-medium">{t("perQuestion")}</p>
          <ol className="flex flex-wrap gap-2">
            {view.questions.map((q, i) => (
              <li
                key={q.testQuestionId}
                className={cn(
                  "flex size-9 items-center justify-center rounded-button text-sm font-semibold",
                  view.perQuestion![q.testQuestionId] ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
                )}
                aria-label={view.perQuestion![q.testQuestionId] ? t("right", { n: i + 1 }) : t("wrong", { n: i + 1 })}
              >
                {i + 1}
              </li>
            ))}
          </ol>
        </Card>
      )}
      <Link href="/tests" className="text-center text-sm text-primary hover:underline">
        {t("backToTests")}
      </Link>
    </div>
  );
}

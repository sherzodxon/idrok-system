"use client";

// Student / guardian portal (mobile-first): the student's online tests to take, and the test history (online and
// offline) — results only when the test allows it (the API decides).
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { AttemptViewDto, StudentSummary, StudentTestDto, TestHistoryItemDto } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { Tabs } from "@/components/ui/toolbar";
import { can, useMe } from "@/lib/use-me";
import { useSave } from "@/lib/use-save";
import { formatInstant, pct, useTestTypeName } from "./common";

const STATE_TONE = {
  AVAILABLE: "success",
  IN_PROGRESS: "primary",
  UPCOMING: "warning",
  DONE: "neutral",
  MISSED: "danger",
} as const;
const HISTORY_TONE = { DONE: "success", MISSED: "danger", EXCUSED: "neutral", PENDING: "warning" } as const;

export function PortalTestsPage() {
  const t = useTranslations("tests");
  const api = useApi();
  const me = useMe();
  const guardian = can(me.data, "portal.guardian");
  const student = can(me.data, "portal.student");
  const children = useQuery({
    queryKey: ["children"],
    queryFn: () => api.get<StudentSummary[]>("/me/children"),
    enabled: guardian,
  });
  const [childId, setChildId] = useState("");
  const studentId = guardian ? childId || children.data?.[0]?.id || "" : (me.data?.profiles.studentId ?? "");
  const [tab, setTab] = useState<"now" | "history">(student ? "now" : "history");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-foreground">{t("portal.title")}</h1>
      {guardian && (children.data?.length ?? 0) > 1 && (
        <Select aria-label={t("portal.child")} value={studentId} onChange={(e) => setChildId(e.target.value)}>
          {(children.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>{`${c.lastName} ${c.firstName}`}</option>
          ))}
        </Select>
      )}
      {student && (
        <Tabs
          tabs={[
            { value: "now", label: t("portal.now") },
            { value: "history", label: t("portal.history") },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
      {tab === "now" && student ? (
        <MyTests />
      ) : studentId ? (
        <History studentId={studentId} />
      ) : (
        <EmptyState text={t("portal.noChild")} />
      )}
    </div>
  );
}

function MyTests() {
  const t = useTranslations("tests");
  const api = useApi();
  const router = useRouter();
  const locale = useLocale();
  const typeName = useTestTypeName();
  const tests = useQuery({
    queryKey: ["my-tests"],
    queryFn: () => api.get<StudentTestDto[]>("/me/tests"),
    refetchInterval: 30_000,
  });
  const start = useSave(
    (testId: string) =>
      api.post<AttemptViewDto>(`/tests/${testId}/start`).then((v) => router.push(`/tests/attempt/${v.id}`)),
    ["my-tests"],
  );
  return (
    <QueryBoundary query={tests} isEmpty={(l) => l.length === 0} empty={<EmptyState text={t("portal.empty")} />}>
      {(list) => (
        <ul className="flex flex-col gap-3" data-testid="my-tests">
          {list.map((x) => {
            const last = x.attempts[x.attempts.length - 1];
            return (
              <li key={x.id}>
                <Card className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{x.title}</p>
                      <p className="text-sm text-muted">{`${x.subjectName} · ${typeName({ code: x.testTypeCode, name: x.testTypeName })}`}</p>
                    </div>
                    <Badge tone={STATE_TONE[x.state]}>{t(`portal.states.${x.state}`)}</Badge>
                  </div>
                  <p className="text-sm text-muted">
                    {[
                      t("portal.questions", { n: x.questionCount }),
                      x.timeLimitMinutes ? t("minutes", { n: x.timeLimitMinutes }) : null,
                      x.endsAt ? t("portal.until", { at: formatInstant(x.endsAt, locale) }) : null,
                      x.state === "UPCOMING" && x.startsAt
                        ? t("portal.from", { at: formatInstant(x.startsAt, locale) })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {last?.result && (
                    <p className="text-sm">
                      {t("portal.result", {
                        score: pct(last.result.score),
                        max: pct(last.result.maxScore),
                        p: pct(last.result.percent),
                      })}
                    </p>
                  )}
                  {(x.state === "AVAILABLE" || x.state === "IN_PROGRESS") && (
                    <Button
                      size="lg"
                      loading={start.isPending && start.variables === x.id}
                      onClick={() => start.mutate(x.id)}
                    >
                      {x.state === "AVAILABLE" ? t("portal.start") : t("portal.continue")}
                    </Button>
                  )}
                  {x.state === "DONE" && last && (
                    <Button variant="secondary" onClick={() => router.push(`/tests/attempt/${last.id}`)}>
                      {t("portal.open")}
                    </Button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </QueryBoundary>
  );
}

function History({ studentId }: { studentId: string }) {
  const t = useTranslations("tests");
  const api = useApi();
  const history = useQuery({
    queryKey: ["test-history", studentId],
    queryFn: () => api.get<TestHistoryItemDto[]>(`/students/${studentId}/test-history`),
  });
  return (
    <QueryBoundary query={history} isEmpty={(l) => l.length === 0} empty={<EmptyState text={t("portal.noHistory")} />}>
      {(list) => (
        <ul className="flex flex-col gap-2" data-testid="test-history">
          {list.map((x) => (
            <li key={x.testId}>
              <Card className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{x.title}</p>
                  <p className="text-xs text-muted">
                    {[x.subjectName, x.date, t(`formats.${x.format}`)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="text-right">
                  {x.percent !== null ? (
                    <p className="tabular text-lg font-bold">{`${pct(x.percent)}%`}</p>
                  ) : (
                    <Badge tone={HISTORY_TONE[x.status]}>{t(`portal.historyStatus.${x.status}`)}</Badge>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </QueryBoundary>
  );
}

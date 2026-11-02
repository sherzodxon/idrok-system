"use client";

// A student's tests on the staff profile (tests.md §8): the test history and topic mastery, weakest topics first.
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { TopicMasteryDto } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { pct } from "./common";
import { History } from "./portal-tests";

export function StudentTestsCard({ studentId }: { studentId: string }) {
  const t = useTranslations("tests");
  const api = useApi();
  const mastery = useQuery({
    queryKey: ["topic-mastery", studentId],
    queryFn: () => api.get<TopicMasteryDto[]>(`/students/${studentId}/topic-mastery`),
  });
  return (
    <>
      <Card className="lg:col-span-2">
        <CardHeader title={t("profile.history")} />
        <div className="p-4">
          <History studentId={studentId} />
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title={t("profile.mastery")} />
        <QueryBoundary
          query={mastery}
          isEmpty={(l) => l.length === 0}
          empty={<EmptyState text={t("profile.noMastery")} />}
        >
          {(list) => (
            <ul className="divide-y divide-border" data-testid="topic-mastery">
              {list.map((m) => (
                <li key={`${m.subjectId}-${m.topicId ?? "none"}`} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {m.topicTitle ?? t("bank.noTopic")}
                    <span className="ml-2 text-xs text-muted">{m.subjectName}</span>
                  </span>
                  <span className="h-2 w-24 overflow-hidden rounded-full bg-surface-muted">
                    <span className="block h-full bg-primary" style={{ width: `${Number(m.percent ?? 0)}%` }} />
                  </span>
                  <span className="tabular w-12 text-right font-semibold">{`${pct(m.percent)}%`}</span>
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </Card>
    </>
  );
}

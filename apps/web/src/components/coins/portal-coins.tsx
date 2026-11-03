"use client";

// Student / guardian portal (mobile-first): balance, totals, the last 30 days and the history; the student also has the
// shop and their orders. A guardian sees their child's coins only.
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { CoinSummaryDto, StudentSummary } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { KpiHeroCard } from "@/components/ui/stats";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { Tabs } from "@/components/ui/toolbar";
import { can, useMe } from "@/lib/use-me";
import { CoinHistory, DailyBars, useCoinStatus } from "./common";
import { MyOrders, StudentShop } from "./shop";

export function PortalCoinsPage() {
  const t = useTranslations("coins");
  const api = useApi();
  const me = useMe();
  const guardian = can(me.data, "portal.guardian");
  const student = can(me.data, "portal.student");
  const status = useCoinStatus();
  const children = useQuery({
    queryKey: ["children"],
    queryFn: () => api.get<StudentSummary[]>("/me/children"),
    enabled: guardian,
  });
  const [childId, setChildId] = useState("");
  const studentId = guardian ? childId || children.data?.[0]?.id || "" : (me.data?.profiles.studentId ?? "");
  const shop = student && !!status.data?.shopEnabled;
  const [tab, setTab] = useState<"history" | "shop" | "orders">("history");
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
      {status.data && !status.data.isEnabled ? (
        <EmptyState text={t("portal.disabled")} />
      ) : studentId ? (
        <>
          <Summary studentId={studentId} />
          {shop && (
            <Tabs
              tabs={[
                { value: "history", label: t("portal.history") },
                { value: "shop", label: t("portal.shop") },
                { value: "orders", label: t("portal.orders") },
              ]}
              value={tab}
              onChange={setTab}
            />
          )}
          {tab === "shop" && shop ? (
            <StudentShop />
          ) : tab === "orders" && shop ? (
            <MyOrders />
          ) : (
            <PortalHistory studentId={studentId} />
          )}
        </>
      ) : (
        <EmptyState text={t("portal.noChild")} />
      )}
    </div>
  );
}

export function useCoinSummary(studentId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["coin-summary", studentId],
    queryFn: () => api.get<CoinSummaryDto>(`/coins/students/${studentId}/summary`),
  });
}

function Summary({ studentId }: { studentId: string }) {
  const t = useTranslations("coins");
  const summary = useCoinSummary(studentId);
  return (
    <QueryBoundary query={summary}>
      {(s) => (
        <div className="flex flex-col gap-3" data-testid="coin-summary">
          <KpiHeroCard
            label={t("portal.balance")}
            value={<span data-testid="coin-balance">{s.balance}</span>}
            hint={s.balance < 0 ? t("portal.debt") : undefined}
          />
          <div className="grid grid-cols-3 gap-2 text-center">
            {(
              [
                ["earned", s.earned, "text-success"],
                ["penalties", s.penalties, "text-danger"],
                ["spent", s.spent, "text-primary-strong"],
              ] as const
            ).map(([k, v, cls]) => (
              <Card key={k} className="p-3">
                <p className={`tabular text-lg font-bold ${cls}`}>{v}</p>
                <p className="text-xs text-muted">{t(`portal.${k}`)}</p>
              </Card>
            ))}
          </div>
          <Card className="p-4">
            <p className="mb-2 text-sm font-medium">{t("portal.last30")}</p>
            <DailyBars series={s.series} labels={{ earned: t("portal.earned"), penalties: t("portal.penalties") }} />
          </Card>
        </div>
      )}
    </QueryBoundary>
  );
}

function PortalHistory({ studentId }: { studentId: string }) {
  const [page, setPage] = useState(1);
  return (
    <Card>
      <CoinHistory
        path={`/coins/students/${studentId}/transactions`}
        queryKey={["student", studentId]}
        page={page}
        onPage={setPage}
      />
    </Card>
  );
}

/** For staff on a student's profile: balance, totals and the latest history. */
export function StudentCoinsCard({ studentId }: { studentId: string }) {
  const t = useTranslations("coins");
  const summary = useCoinSummary(studentId);
  const [page, setPage] = useState(1);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h2 className="text-base font-semibold text-foreground">{t("portal.title")}</h2>
        {summary.data && (
          <span className="text-sm text-muted">
            {t("profileLine", {
              balance: summary.data.balance,
              earned: summary.data.earned,
              penalties: summary.data.penalties,
              spent: summary.data.spent,
            })}
          </span>
        )}
      </div>
      <CoinHistory
        path={`/coins/students/${studentId}/transactions`}
        queryKey={["student", studentId]}
        page={page}
        onPage={setPage}
        testId="student-coins"
      />
    </Card>
  );
}

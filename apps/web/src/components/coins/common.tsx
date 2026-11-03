"use client";

// Shared coin UI: the status switches, signed amounts, transaction kinds, the history table and the daily bars.
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import type { CoinStatusDto, CoinTransactionDto, Page } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { cn } from "@/lib/cn";

/** A fresh idempotency key per user action (ledger writes are natural-key idempotent on the server). */
export const newKey = () => crypto.randomUUID();

export function useCoinStatus(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: ["coin-status"],
    queryFn: () => api.get<CoinStatusDto>("/coins/status"),
    enabled,
    staleTime: 60_000,
  });
}

export function CoinAmount({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        "tabular font-semibold",
        value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-muted",
        className,
      )}
    >
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

const TYPE_TONE: Record<CoinTransactionDto["type"], "neutral" | "primary" | "success" | "warning" | "danger"> = {
  REWARD: "success",
  PENALTY: "danger",
  PURCHASE: "primary",
  REFUND: "neutral",
  ADMIN_ADJUSTMENT: "warning",
  REVERSAL: "neutral",
  CORRECTION: "neutral",
};

export function TxTypeBadge({ tx }: { tx: Pick<CoinTransactionDto, "type" | "source"> }) {
  const t = useTranslations("coins");
  const automatic = tx.type === "REWARD" && tx.source !== "TEACHER_CRITERION";
  return <Badge tone={TYPE_TONE[tx.type]}>{automatic ? t("types.AUTO") : t(`types.${tx.type}`)}</Badge>;
}

export const formatDateTime = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/** What a row is about: the criterion, the reason or the order. */
function useTxSubject() {
  const t = useTranslations("coins");
  return (x: CoinTransactionDto) =>
    x.criterionName ??
    x.reason ??
    (x.type === "PURCHASE" ? t("types.PURCHASE") : x.type === "REFUND" ? t("types.REFUND") : "—");
}

/**
 * A page of transactions. `showStudent` for the ledger, `actions` for row buttons (undo, correct). The query key and
 * path come from the caller so every list refreshes after a write.
 */
export function CoinHistory({
  path,
  queryKey,
  showStudent = false,
  showTeacher = true,
  actions,
  page,
  onPage,
  testId = "coin-history",
}: {
  path: string;
  queryKey: unknown[];
  showStudent?: boolean;
  showTeacher?: boolean;
  actions?: (x: CoinTransactionDto) => React.ReactNode;
  page: number;
  onPage: (page: number) => void;
  testId?: string;
}) {
  const t = useTranslations("coins");
  const api = useApi();
  const locale = useLocale();
  const subject = useTxSubject();
  const sep = path.includes("?") ? "&" : "?";
  const list = useQuery({
    queryKey: ["coin-transactions", ...queryKey, page],
    queryFn: () => api.get<Page<CoinTransactionDto>>(`${path}${sep}page=${page}&pageSize=20`),
  });
  return (
    <QueryBoundary query={list} isEmpty={(p) => p.items.length === 0} empty={<EmptyState text={t("noTransactions")} />}>
      {(p) => (
        <>
          <DataTable
            testId={testId}
            rows={p.items}
            columns={[
              {
                key: "subject",
                header: t("what"),
                primary: true,
                cell: (x) => (
                  <span className={cn("flex flex-col", x.reversed && "line-through opacity-60")}>
                    <span className="font-medium">{subject(x)}</span>
                    {showStudent && <span className="text-xs text-muted">{x.studentName}</span>}
                  </span>
                ),
              },
              { key: "type", header: t("kind"), cell: (x) => <TxTypeBadge tx={x} /> },
              {
                key: "amount",
                header: t("amount"),
                cell: (x) => (
                  <span className="flex items-center gap-1">
                    <CoinAmount value={x.amount} />
                    {x.effectiveAmount !== null && x.effectiveAmount !== x.amount && (
                      <span className="text-xs text-muted">{t("correctedTo", { n: x.effectiveAmount })}</span>
                    )}
                  </span>
                ),
              },
              ...(showTeacher
                ? [{ key: "teacher", header: t("byWhom"), cell: (x: CoinTransactionDto) => x.teacherName ?? "—" }]
                : []),
              { key: "when", header: t("when"), cell: (x) => formatDateTime(x.createdAt, locale) },
              {
                key: "balance",
                header: t("balanceAfter"),
                cell: (x) => <span className="tabular">{x.balanceAfter}</span>,
              },
              ...(actions ? [{ key: "actions", header: "", cell: actions }] : []),
            ]}
          />
          <Pagination page={p.page} pageSize={p.pageSize} total={p.total} onPage={onPage} />
        </>
      )}
    </QueryBoundary>
  );
}

/** Earned (up) and penalties (down) per day, as plain bars — no chart library needed for this. */
export function DailyBars({
  series,
  labels,
}: {
  series: { date: string; earned: number; penalties: number }[];
  labels: { earned: string; penalties: string };
}) {
  const max = Math.max(1, ...series.flatMap((d) => [d.earned, d.penalties]));
  return (
    <div>
      <div className="flex h-28 items-center gap-0.5" role="img" aria-label={`${labels.earned} / ${labels.penalties}`}>
        {series.map((d) => (
          <div key={d.date} className="flex h-full flex-1 flex-col" title={`${d.date}: +${d.earned} / −${d.penalties}`}>
            <div className="flex flex-1 items-end">
              <div className="w-full rounded-t-sm bg-success" style={{ height: `${(d.earned / max) * 100}%` }} />
            </div>
            <div className="flex flex-1 items-start">
              <div className="w-full rounded-b-sm bg-danger" style={{ height: `${(d.penalties / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-success" aria-hidden />
          {labels.earned}
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-danger" aria-hidden />
          {labels.penalties}
        </span>
      </div>
    </div>
  );
}

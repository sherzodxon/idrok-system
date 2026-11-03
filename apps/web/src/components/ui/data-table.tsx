"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Shown as the card title on phones. */
  primary?: boolean;
  className?: string;
}

/** Table on wide screens, stacked cards on phones (no horizontal scroll, ui-structure.md §7). */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  onRowClick,
  testId,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  testId?: string;
}) {
  const primary = columns.find((c) => c.primary) ?? columns[0]!;
  const rest = columns.filter((c) => c !== primary);
  return (
    <div data-testid={testId}>
      <table className="hidden w-full text-left text-sm md:table">
        <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("px-4 py-3 font-medium", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(onRowClick && "cursor-pointer hover:bg-surface-muted")}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn("px-4 py-3 align-middle", c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-border md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            {/* Without a row action the card is a plain block, so buttons inside cells are not nested buttons. */}
            {onRowClick ? (
              <button
                type="button"
                onClick={() => onRowClick(row)}
                className="flex w-full flex-col gap-1 px-4 py-3 text-left"
              >
                <MobileCard row={row} primary={primary} rest={rest} />
              </button>
            ) : (
              <div className="flex w-full flex-col gap-1 px-4 py-3">
                <MobileCard row={row} primary={primary} rest={rest} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations("list");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted">
      <span className="tabular">{t("range", { from, to, total })}</span>
      <div className="flex gap-1">
        <button
          type="button"
          aria-label={t("previous")}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="rounded-button p-1.5 hover:bg-surface-muted disabled:opacity-40"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <span className="tabular px-2 py-1">{t("pageOf", { page, pages })}</span>
        <button
          type="button"
          aria-label={t("next")}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="rounded-button p-1.5 hover:bg-surface-muted disabled:opacity-40"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function MobileCard<T>({ row, primary, rest }: { row: T; primary: Column<T>; rest: Column<T>[] }) {
  return (
    <>
      <span className="font-medium text-foreground">{primary.cell(row)}</span>
      {rest.map((c) => (
        <span key={c.key} className="flex min-w-0 gap-2 text-sm">
          {c.header && <span className="shrink-0 text-muted">{c.header}:</span>}
          <span className="min-w-0 truncate">{c.cell(row)}</span>
        </span>
      ))}
    </>
  );
}

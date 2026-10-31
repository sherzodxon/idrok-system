"use client";

import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api-client";
import { useErrorText } from "@/lib/use-error-text";
import { Button } from "./button";
import { Skeleton } from "./skeleton";

export function EmptyState({
  title,
  text,
  action,
  icon,
}: {
  title?: string;
  text?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  const t = useTranslations("states");
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
        {icon ?? <Inbox className="size-6" aria-hidden />}
      </span>
      <p className="font-semibold text-foreground">{title ?? t("emptyTitle")}</p>
      {text && <p className="max-w-sm text-sm text-muted">{text}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations();
  const message = useErrorText()(error);
  const requestId = error instanceof ApiError ? (error.details?.requestId as string | undefined) : undefined;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <p className="font-semibold text-foreground">{t("states.errorTitle")}</p>
      <p className="max-w-sm text-sm text-muted">{message}</p>
      {requestId && <p className="text-xs text-disabled">{t("common.requestId", { id: requestId })}</p>}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

export function LoadingState({ rows = 3 }: { rows?: number }) {
  const t = useTranslations("common");
  return (
    <div className="flex flex-col gap-3 p-5" aria-busy>
      <span className="sr-only">
        <Loader2 aria-hidden /> {t("loading")}
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** Renders loading / error / empty / data for a TanStack query — every page uses it (CLAUDE.md §4 UI). */
export function QueryBoundary<T>({
  query,
  isEmpty,
  empty,
  loading,
  children,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{loading ?? <LoadingState />}</>;
  if (query.isError || query.data === undefined)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (isEmpty?.(query.data)) return <>{empty ?? <EmptyState />}</>;
  return <>{children(query.data)}</>;
}

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card } from "./card";
import { Skeleton } from "./skeleton";

export function StatCard({
  label,
  value,
  hint,
  icon,
  loading,
  delta,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  loading?: boolean;
  /** Change against the previous period, already worded ("+3 since yesterday"); tone says if it is good news. */
  delta?: { text: string; tone: "good" | "bad" | "neutral" };
}) {
  return (
    <Card className="flex items-center gap-4 p-5">
      {icon && (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-sm text-muted">{label}</p>
        {loading ? (
          <Skeleton className="mt-1 h-7 w-16" />
        ) : (
          <p className="tabular text-2xl font-bold text-foreground">{value}</p>
        )}
        {delta && !loading && (
          <p
            className={cn(
              "text-xs font-semibold",
              delta.tone === "good" && "text-success",
              delta.tone === "bad" && "text-danger",
              delta.tone === "neutral" && "text-muted",
            )}
          >
            {delta.text}
          </p>
        )}
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
    </Card>
  );
}

/** The one primary-filled KPI card of a dashboard (design reference). */
export function KpiHeroCard({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-card bg-linear-135 from-brand to-brand-deep p-5 text-on-brand shadow-card">
      <p className="text-sm opacity-90">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-9 w-20 opacity-40" />
      ) : (
        <p className="tabular mt-1 text-3xl font-bold">{value}</p>
      )}
      {hint && <p className="mt-1 text-xs opacity-80">{hint}</p>}
    </div>
  );
}

export function ProgressRing({ percent, size = 64, label }: { percent: number; size?: number; label: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <svg width={size} height={size} role="img" aria-label={label} className={cn("-rotate-90")}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-surface-muted" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p / 100)}
        className="stroke-primary"
      />
    </svg>
  );
}

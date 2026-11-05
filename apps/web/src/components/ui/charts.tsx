"use client";

// Small dependency-free charts for dashboards and profile pages (design system, audit 2026-11-05).
// All colours are theme tokens; numbers are computed by the API — these only draw them.
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { areaPath, linear, linePath, niceDomain, percentOf, tickValues } from "@/lib/chart-scale";
import { cn } from "@/lib/cn";

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(120, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export interface TrendPoint {
  /** Axis label; empty strings are skipped so long series stay readable. */
  label: string;
  value: number | null;
}

/** Line + area over time with a faint grid and the last value marked. `null` = no data for that point. */
export function TrendChart({
  points,
  height = 180,
  floor,
  ceil,
  format = String,
  label,
}: {
  points: TrendPoint[];
  height?: number;
  floor?: number;
  ceil?: number;
  format?: (v: number) => string;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const left = 36;
  const right = 12;
  const top = 14;
  const bottom = 22;
  const domain = niceDomain(
    points.map((p) => p.value ?? Number.NaN),
    4,
    floor,
    ceil,
  );
  const x = linear({ min: 0, max: Math.max(1, points.length - 1) }, left, width - right);
  const y = linear(domain, height - bottom, top);
  const xy = points.map((p, i) => ({ x: x(i), y: p.value === null ? null : y(p.value) }));
  const lastIndex = points.findLastIndex((p) => p.value !== null);
  const last = lastIndex >= 0 ? { ...xy[lastIndex]!, v: points[lastIndex]!.value! } : null;
  return (
    <div ref={ref} className="w-full min-w-0">
      {/* width="100%" keeps the SVG from widening its grid cell; geometry uses the measured width. */}
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        className="block overflow-visible"
      >
        {tickValues(domain).map((v) => (
          <g key={v}>
            <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
            <text x={left - 6} y={y(v) + 3.5} textAnchor="end" className="fill-muted text-[10px]">
              {format(v)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          p.label ? (
            <text key={i} x={x(i)} y={height - 6} textAnchor="middle" className="fill-muted text-[10px]">
              {p.label}
            </text>
          ) : null,
        )}
        <path d={areaPath(xy, height - bottom)} className="fill-primary opacity-15" />
        <path
          d={linePath(xy)}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-primary"
        />
        {last && last.y !== null && (
          <>
            <circle cx={last.x} cy={last.y} r={4} className="fill-primary stroke-surface" strokeWidth={2} />
            <text
              x={last.x}
              y={last.y - 9}
              textAnchor={last.x > width / 2 ? "end" : "start"}
              className="fill-foreground text-[11px] font-bold"
            >
              {format(last.v)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

/** Horizontal bars with the value at the end (classes, subjects). `max` defaults to the largest value. */
export function BarList({
  items,
  max,
  format = String,
}: {
  items: { key: string; label: string; value: number }[];
  max?: number;
  format?: (v: number) => string;
}) {
  const top = max ?? Math.max(0, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item.key} className="grid grid-cols-[minmax(3.5rem,auto)_1fr_3rem] items-center gap-3 text-sm">
          <span className="truncate text-muted">{item.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-muted">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${percentOf(item.value, top)}%` }}
            />
          </span>
          <span className="tabular text-right font-semibold text-foreground">{format(item.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export type DayMark = "present" | "late" | "absent" | "excused" | "off";

const MARK_CLASS: Record<DayMark, string> = {
  present: "bg-success",
  late: "bg-warning",
  absent: "bg-danger",
  excused: "bg-primary",
  off: "bg-border",
};

/** One square per school day, oldest first; the legend lists only marks that occur. */
export function AttendanceHeatmap({
  days,
  columns = 20,
  formatDate = (d) => d,
}: {
  days: { date: string; mark: DayMark | null }[];
  columns?: number;
  formatDate?: (date: string) => string;
}) {
  const t = useTranslations("charts.attendance");
  const used = (Object.keys(MARK_CLASS) as DayMark[]).filter((m) => days.some((d) => d.mark === m));
  return (
    <div className="flex flex-col gap-3">
      <ul className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {days.map((d) => (
          <li
            key={d.date}
            title={`${formatDate(d.date)} · ${t(d.mark ?? "none")}`}
            aria-label={`${formatDate(d.date)}: ${t(d.mark ?? "none")}`}
            className={cn("aspect-square rounded-[3px]", d.mark ? MARK_CLASS[d.mark] : "bg-surface-muted")}
          />
        ))}
      </ul>
      {used.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {used.map((m) => (
            <li key={m} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-[2px]", MARK_CLASS[m])} aria-hidden />
              {t(m)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Used / limit bar: warning from 80 %, danger when the limit is reached. */
export function LimitMeter({ used, limit, className }: { used: number; limit: number; className?: string }) {
  const t = useTranslations("charts");
  const p = percentOf(used, limit);
  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={used}
      aria-label={t("limitUsed", { used, limit })}
      className={cn("inline-block h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted align-middle", className)}
    >
      <span
        className={cn("block h-full rounded-full", p >= 100 ? "bg-danger" : p >= 80 ? "bg-warning" : "bg-primary")}
        style={{ width: `${p}%` }}
      />
    </span>
  );
}

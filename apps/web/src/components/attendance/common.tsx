"use client";

// Shared bits of the M6 screens: status badges, times in the school's time zone, the feature switch.
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { SchoolAttendanceStatusDto } from "@idrok/shared";
import { isoWeekday, type SchoolDate } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

const STATUS_TONE: Record<SchoolAttendanceStatusDto, Tone> = {
  PRESENT: "success",
  LATE: "warning",
  ABSENT: "danger",
  NOT_ARRIVED: "neutral",
  EXCUSED: "primary",
  NO_DATA: "neutral",
};

export function AttendanceStatusBadge({ status }: { status: SchoolAttendanceStatusDto }) {
  const t = useTranslations("attendance");
  return <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>;
}

export function ConnectionBadge({ value }: { value: "ONLINE" | "OFFLINE" | "UNKNOWN" }) {
  const t = useTranslations("attendance");
  return (
    <Badge tone={value === "ONLINE" ? "success" : value === "OFFLINE" ? "danger" : "neutral"}>
      {t(`connection.${value}`)}
    </Badge>
  );
}

export function FaceBadge({ value }: { value: "NONE" | "SYNCED" | "PENDING" | "IN_PROGRESS" | "FAILED" }) {
  const t = useTranslations("attendance");
  const tone: Tone =
    value === "SYNCED" ? "success" : value === "FAILED" ? "danger" : value === "NONE" ? "neutral" : "warning";
  return <Badge tone={tone}>{t(`face.${value}`)}</Badge>;
}

const fmt = (locale: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "uz-UZ", { timeZone: "Asia/Tashkent", ...opts });

/** "08:25" in the school's time zone. */
export const formatTime = (iso: string | null, locale: string) =>
  iso ? fmt(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "—";

export const formatDateTime = (iso: string | null, locale: string) =>
  iso
    ? fmt(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(
        new Date(iso),
      )
    : "—";

/** "2026-11-11" → "11.11, Ch" (a school date is a calendar day; weekday names from our own translations). */
export function useFormatDay() {
  const t = useTranslations("calendar");
  return (date: string) =>
    `${date.slice(8, 10)}.${date.slice(5, 7)}, ${t(`weekdaysShort.${isoWeekday(date as SchoolDate)}`)}`;
}

/** "08:30" ↔ 510. */
export const toHhMm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const fromHhMm = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export function useAttendanceFeature() {
  const api = useApi();
  return useQuery({
    queryKey: ["attendance-status"],
    queryFn: () => api.get<{ isEnabled: boolean }>("/attendance/status"),
    staleTime: 60_000,
  });
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4" />
      {label}
    </label>
  );
}

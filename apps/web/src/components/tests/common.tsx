"use client";

// Shared bits of the M4 screens: downloads, images behind auth, percent display, labels of test states.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import type { TestStatusCode } from "@idrok/shared";
import { atSchoolTime, parseSchoolDate } from "@idrok/shared/time";

export function saveBlob({ blob, fileName }: { blob: Blob; fileName: string }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** An image served by an authenticated endpoint (question images): fetched with the session, shown as a blob URL. */
export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const api = useApi();
  const image = useQuery({ queryKey: ["image", path], queryFn: () => api.download(path), staleTime: 3_600_000 });
  const url = useMemo(() => (image.data ? URL.createObjectURL(image.data.blob) : null), [image.data]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (!url) return null;
  return <img src={url} alt={alt} className={className} />;
}

/** Percent for display: at most two decimals, no trailing zeros. */
export const pct = (v: string | null | undefined) =>
  v === null || v === undefined ? "—" : String(Math.round(Number(v) * 100) / 100);

const STATUS_TONE: Record<TestStatusCode, "neutral" | "primary" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  SCHEDULED: "warning",
  OPEN: "success",
  CLOSED: "primary",
  ARCHIVED: "neutral",
};

export function TestStatusBadge({ status }: { status: TestStatusCode }) {
  const t = useTranslations("tests");
  return <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>;
}

/** System test types are shown by their code's translation; the school's own by their name. */
export function useTestTypeName() {
  const t = useTranslations("tests");
  return (type: { code: string; name: string }) => (t.has(`types.${type.code}`) ? t(`types.${type.code}`) : type.name);
}

const TZ = "Asia/Tashkent";

/** `datetime-local` value in school time ↔ ISO instant (whatever the browser's own time zone). */
export function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function fromLocalInput(v: string) {
  if (!v) return null;
  const [h, m] = v.slice(11, 16).split(":").map(Number);
  return atSchoolTime(parseSchoolDate(v.slice(0, 10)), h! * 60 + m!, TZ).toISOString();
}

export function formatInstant(iso: string | null, locale: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "uz-UZ", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

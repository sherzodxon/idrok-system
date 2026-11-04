// Dates and times shown in the UI: one fixed shape in the school's time zone ("05.11.2026 08:25"), the same in uz and
// ru. Browsers have no Uzbek date patterns (dateStyle gives "2026 M11 5"), so the shape is built from parts.
const parts = (iso: string | Date, withSeconds = false) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {}),
      hourCycle: "h23",
    })
      .formatToParts(typeof iso === "string" ? new Date(iso) : iso)
      .map((x) => [x.type, x.value]),
  );
  return p as Record<"day" | "month" | "year" | "hour" | "minute" | "second", string>;
};

/** "05.11.2026 08:25" (or "—"). */
export function formatDateTime(iso: string | Date | null | undefined, withSeconds = false): string {
  if (!iso) return "—";
  const p = parts(iso, withSeconds);
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}${withSeconds ? `:${p.second}` : ""}`;
}

/** "05.11.2026" (or "—"). */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const p = parts(iso);
  return `${p.day}.${p.month}.${p.year}`;
}

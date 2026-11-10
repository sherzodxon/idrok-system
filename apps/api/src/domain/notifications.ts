// Pure notification rules (M7, T-94/T-95): quiet hours and the attendance rate. No DB access.
import { D, type Decimal } from "@idrok/shared/decimal";
import { atSchoolTime, schoolMinuteOfDay, toSchoolDate, addSchoolDays } from "@idrok/shared/time";

export interface QuietHours {
  startMinute: number;
  endMinute: number;
}

/** The guardian's own quiet hours win; `off` means never quiet; otherwise the school's. */
export function effectiveQuietHours(
  school: QuietHours,
  own: { quietStartMinute: number | null; quietEndMinute: number | null; quietHoursOff: boolean } | null,
): QuietHours | null {
  if (own?.quietHoursOff) return null;
  if (own && own.quietStartMinute !== null && own.quietEndMinute !== null)
    return { startMinute: own.quietStartMinute, endMinute: own.quietEndMinute };
  return school;
}

/** Whether a minute of the day is inside [start, end) — the window may cross midnight (22:00–07:00). */
export function isQuietMinute(minute: number, q: QuietHours): boolean {
  if (q.startMinute === q.endMinute) return false;
  return q.startMinute < q.endMinute
    ? minute >= q.startMinute && minute < q.endMinute
    : minute >= q.startMinute || minute < q.endMinute;
}

/** `at`, or the end of the quiet hours it falls in (school time zone). */
export function deferForQuietHours(at: Date, q: QuietHours | null, tz: string): Date {
  if (!q) return at;
  const minute = schoolMinuteOfDay(at, tz);
  if (!isQuietMinute(minute, q)) return at;
  const day = toSchoolDate(at, tz);
  // Before midnight in a window that crosses it, the quiet hours end tomorrow.
  const endDay = q.startMinute > q.endMinute && minute >= q.startMinute ? addSchoolDays(day, 1) : day;
  return atSchoolTime(endDay, q.endMinute, tz);
}

/** Attended share of expected school days, in percent (null when no day was expected). */
export function attendanceRate(expectedDays: number, attendedDays: number): Decimal | null {
  if (expectedDays <= 0) return null;
  return D(attendedDays).mul(100).div(expectedDays).toDecimalPlaces(2);
}

export const isBelowThreshold = (rate: Decimal | null, threshold: string) => rate !== null && rate.lt(D(threshold));

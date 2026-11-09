// The single place for calendar math (CLAUDE.md §4). Everything else works with:
//  - instants (`Date`, stored as timestamptz/UTC), and
//  - school dates (`SchoolDate`, "YYYY-MM-DD" in the school's timezone, stored as `date`).
// Implemented on Intl so it never depends on the process timezone (TZ=UTC and TZ=Asia/Tashkent behave the same).

/** A calendar day in the school's timezone, "YYYY-MM-DD". */
export type SchoolDate = string & { readonly __brand: "SchoolDate" };
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DEFAULT_SCHOOL_TZ = "Asia/Tashkent";

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ---------- school dates as UTC day numbers (pure arithmetic, no timezone involved)

function toDayNumber(d: SchoolDate): number {
  const m = DATE_RE.exec(d);
  if (!m) throw new RangeError(`Invalid school date: ${d}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

function fromDayNumber(n: number): SchoolDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10) as SchoolDate;
}

export function isSchoolDate(value: unknown): value is SchoolDate {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toISOString().slice(0, 10) === value;
}

export function parseSchoolDate(value: string): SchoolDate {
  if (!isSchoolDate(value)) throw new RangeError(`Invalid school date: ${value}`);
  return value;
}

export function addSchoolDays(d: SchoolDate, days: number): SchoolDate {
  return fromDayNumber(toDayNumber(d) + days);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffSchoolDays(a: SchoolDate, b: SchoolDate): number {
  return toDayNumber(b) - toDayNumber(a);
}

export function compareSchoolDate(a: SchoolDate, b: SchoolDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isoWeekday(d: SchoolDate): IsoWeekday {
  // Day 0 (1970-01-01) was a Thursday (ISO 4).
  return (((((toDayNumber(d) + 3) % 7) + 7) % 7) + 1) as IsoWeekday;
}

/** Inclusive range of the week containing `d`. */
export function weekRange(d: SchoolDate, weekStartsOn: IsoWeekday = 1): { from: SchoolDate; to: SchoolDate } {
  const back = (isoWeekday(d) - weekStartsOn + 7) % 7;
  const from = addSchoolDays(d, -back);
  return { from, to: addSchoolDays(from, 6) };
}

/** Inclusive range of the calendar month containing `d`. */
export function monthRange(d: SchoolDate): { from: SchoolDate; to: SchoolDate } {
  const [y, m] = d.split("-").map(Number) as [number, number];
  const from = fromDayNumber(Date.UTC(y, m - 1, 1) / DAY_MS);
  const to = fromDayNumber(Date.UTC(y, m, 1) / DAY_MS - 1);
  return { from, to };
}

/** Every date from `from` to `to`, both included. */
export function* eachSchoolDate(from: SchoolDate, to: SchoolDate): Generator<SchoolDate> {
  for (let n = toDayNumber(from), end = toDayNumber(to); n <= end; n++) yield fromDayNumber(n);
}

// ---------- instants ↔ school dates (timezone aware)

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Wall-clock fields of `instant` in `tz`. */
function wallClock(instant: Date, tz: string) {
  const parts = zoneFormatter(tz).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** UTC offset of `tz` at `instant`, in milliseconds (positive east of Greenwich). */
function offsetMs(instant: Date, tz: string): number {
  const w = wallClock(instant, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    zoneFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** The school day an instant falls on. */
export function toSchoolDate(instant: Date, tz: string = DEFAULT_SCHOOL_TZ): SchoolDate {
  const w = wallClock(instant, tz);
  return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}` as SchoolDate;
}

/** Wall-clock minute of the day (0..1439) of an instant in the school's time zone. */
export function schoolMinuteOfDay(instant: Date, tz: string = DEFAULT_SCHOOL_TZ): number {
  const w = wallClock(instant, tz);
  return (w.h % 24) * 60 + w.min;
}

export function schoolToday(tz: string = DEFAULT_SCHOOL_TZ, now: Date = new Date()): SchoolDate {
  return toSchoolDate(now, tz);
}

/** The instant of `minuteOfDay` (0..1439) wall-clock time on school date `d` in `tz`. */
export function atSchoolTime(d: SchoolDate, minuteOfDay: number, tz: string = DEFAULT_SCHOOL_TZ): Date {
  if (!Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > 1439) {
    throw new RangeError(`Invalid minute of day: ${minuteOfDay}`);
  }
  const wallAsUtc = toDayNumber(d) * DAY_MS + minuteOfDay * 60_000;
  // First guess with the offset at that wall time read as UTC, then correct once (handles DST zones too).
  let instant = wallAsUtc - offsetMs(new Date(wallAsUtc), tz);
  instant = wallAsUtc - offsetMs(new Date(instant), tz);
  return new Date(instant);
}

export function startOfSchoolDay(d: SchoolDate, tz: string = DEFAULT_SCHOOL_TZ): Date {
  return atSchoolTime(d, 0, tz);
}

/** [start, end) instants of school day `d`. */
export function schoolDayRange(d: SchoolDate, tz: string = DEFAULT_SCHOOL_TZ): { start: Date; end: Date } {
  return { start: startOfSchoolDay(d, tz), end: startOfSchoolDay(addSchoolDays(d, 1), tz) };
}

/** "08:30" → 510. */
export function parseTimeOfDay(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) throw new RangeError(`Invalid time of day: ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 510 → "08:30". */
export function formatTimeOfDay(minuteOfDay: number): string {
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
}

// ---------- database adapter (Prisma maps @db.Date to a Date at UTC midnight)

export function schoolDateToDb(d: SchoolDate): Date {
  return new Date(toDayNumber(d) * DAY_MS);
}

export function schoolDateFromDb(value: Date): SchoolDate {
  return value.toISOString().slice(0, 10) as SchoolDate;
}

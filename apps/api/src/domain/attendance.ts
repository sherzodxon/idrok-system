// School attendance from Face ID access events (MASTER_SPEC §11). Pure: no database, no clock — "now" is passed in.
//
// - The day is the school day (schoolDate, school time zone) the event happened on, never the server's local day.
// - An event's direction comes from the device: IN / OUT cameras decide it; a BOTH terminal uses the event's
//   checkIn / checkOut status, and without one the first event of the day is the arrival and later ones are leaving.
// - Arrival = first IN of the day; departure = last OUT after the arrival. Repeated scans change nothing else.
// - Lateness is counted from the start of the student's shift in whole minutes (seconds are dropped). Up to
//   `graceMinutes` is on time. The lateness band is the one whose [fromMinute, toMinute) holds the late minutes.
// - Leaving before the end of the shift is an early leave. A student with no arrival is absent once the day is over
//   (until then they are "not arrived yet").
// - A manual mark (device down, forgotten face) wins over the device and keeps the device times for reference.
// - Only days the student is expected at school count (working day for their grade, active enrollment).
import { atSchoolTime, toSchoolDate, type SchoolDate } from "@idrok/shared/time";

export type DeviceDirection = "IN" | "OUT" | "BOTH";
export type EventDirection = "IN" | "OUT";
export type SchoolAttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | "NOT_ARRIVED";
export type ManualAttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";

export interface LatenessBand {
  id: string;
  /** Inclusive, minutes late. */
  fromMinute: number;
  /** Exclusive; null = no upper bound. */
  toMinute: number | null;
}

export interface AccessPoint {
  at: Date;
  /** Resolved direction, or null for a BOTH terminal that sent no checkIn / checkOut. */
  direction: EventDirection | null;
}

export interface DayRules {
  schoolDate: SchoolDate;
  /** Minutes from midnight, school time zone. */
  startMinute: number;
  endMinute: number;
  graceMinutes: number;
  bands: LatenessBand[];
  tz: string;
}

export interface DayResult {
  firstInAt: Date | null;
  lastOutAt: Date | null;
  status: SchoolAttendanceStatus;
  lateMinutes: number;
  latenessBandId: string | null;
  earlyLeaveMinutes: number;
}

/** Direction of one event: the camera's own for IN / OUT devices, the event status for a BOTH terminal. */
export function eventDirection(device: DeviceDirection, status: string | null | undefined): EventDirection | null {
  if (device !== "BOTH") return device;
  const s = (status ?? "").toLowerCase();
  if (s === "checkin" || s === "breakin" || s === "overtimein") return "IN";
  if (s === "checkout" || s === "breakout" || s === "overtimeout") return "OUT";
  return null;
}

export function bandFor(lateMinutes: number, bands: LatenessBand[]): LatenessBand | null {
  return bands.find((b) => lateMinutes >= b.fromMinute && (b.toMinute === null || lateMinutes < b.toMinute)) ?? null;
}

/** Bands sorted by start must not overlap; a gap is allowed (late without a band). */
export function bandsOverlap(bands: Pick<LatenessBand, "fromMinute" | "toMinute">[]): boolean {
  const sorted = [...bands].sort((a, b) => a.fromMinute - b.fromMinute);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    if (prev.toMinute === null || prev.toMinute > sorted[i]!.fromMinute) return true;
  }
  return false;
}

const wholeMinutes = (ms: number) => Math.floor(ms / 60_000);

/**
 * One student's school attendance for one day. `events` may be unsorted and contain other days' events (ignored).
 * `dayOver` = the school day has ended (or the student can no longer arrive), so no arrival means absent.
 */
export function dailyAttendance(events: AccessPoint[], rules: DayRules, dayOver: boolean): DayResult {
  const today = events
    .filter((e) => toSchoolDate(e.at, rules.tz) === rules.schoolDate)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  let firstIn: Date | null = null;
  let lastOut: Date | null = null;
  for (const e of today) {
    const dir = e.direction ?? (firstIn ? "OUT" : "IN");
    if (dir === "IN") {
      firstIn ??= e.at;
    } else if (firstIn) {
      lastOut = e.at;
    }
  }
  if (!firstIn) {
    return {
      firstInAt: null,
      lastOutAt: null,
      status: dayOver ? "ABSENT" : "NOT_ARRIVED",
      lateMinutes: 0,
      latenessBandId: null,
      earlyLeaveMinutes: 0,
    };
  }
  const start = atSchoolTime(rules.schoolDate, rules.startMinute, rules.tz);
  const end = atSchoolTime(rules.schoolDate, rules.endMinute, rules.tz);
  const late = Math.max(0, wholeMinutes(firstIn.getTime() - start.getTime()));
  const isLate = late > rules.graceMinutes;
  const earlyLeave = lastOut ? Math.max(0, wholeMinutes(end.getTime() - lastOut.getTime())) : 0;
  return {
    firstInAt: firstIn,
    lastOutAt: lastOut,
    status: isLate ? "LATE" : "PRESENT",
    lateMinutes: isLate ? late : 0,
    latenessBandId: isLate ? (bandFor(late, rules.bands)?.id ?? null) : null,
    earlyLeaveMinutes: earlyLeave,
  };
}

/** The status shown in reports: a manual mark wins; EXCUSED is its own status. */
export function effectiveStatus(
  device: SchoolAttendanceStatus,
  manual: ManualAttendanceStatus | null,
): SchoolAttendanceStatus | "EXCUSED" {
  return manual ?? device;
}

/** The school day is over for attendance purposes at the end of the shift. */
export function isDayOver(rules: Pick<DayRules, "schoolDate" | "endMinute" | "tz">, now: Date): boolean {
  return now.getTime() >= atSchoolTime(rules.schoolDate, rules.endMinute, rules.tz).getTime();
}

// ---------- attendance coins

/** ON_TIME, or a lateness band id. */
export type AttendanceOutcome = "ON_TIME" | string;

export interface AttendanceCoinRule {
  outcome: AttendanceOutcome;
  /** Positive = reward, negative = penalty. */
  amount: number;
}

/**
 * The coin outcome of a day: on time, or the lateness band. No coins for absence, a late arrival outside every band,
 * or a manual mark (the device result was overruled; the school decides by hand).
 */
export function attendanceOutcome(
  result: Pick<DayResult, "status" | "latenessBandId">,
  manual: ManualAttendanceStatus | null,
): AttendanceOutcome | null {
  if (manual) return null;
  if (result.status === "PRESENT") return "ON_TIME";
  if (result.status === "LATE") return result.latenessBandId;
  return null;
}

export function attendanceAward(
  outcome: AttendanceOutcome | null,
  rules: AttendanceCoinRule[],
): AttendanceCoinRule | null {
  if (!outcome) return null;
  return rules.find((r) => r.outcome === outcome && r.amount !== 0) ?? null;
}

// ---------- device health

export type ConnectionStatus = "ONLINE" | "OFFLINE" | "UNKNOWN";

/** A device (or bridge) is online when it was heard from within `staleSeconds`. */
export function connectionStatus(lastSeenAt: Date | null, now: Date, staleSeconds: number): ConnectionStatus {
  if (!lastSeenAt) return "UNKNOWN";
  return now.getTime() - lastSeenAt.getTime() <= staleSeconds * 1000 ? "ONLINE" : "OFFLINE";
}

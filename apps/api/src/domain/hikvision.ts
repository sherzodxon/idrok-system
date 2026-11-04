// Hikvision ISAPI event payloads (HTTP listening / "alarm host" push, JSON firmware). Pure parsing: the webhook hands
// in the JSON part of the multipart body (`event_log` / `AccessControllerEvent`) or a JSON body.
//
// - heartBeat events (and AccessControllerEvent without a person) only mark the device as alive.
// - An access is counted only for a verified person: major event 5 (event) with a "verify passed" minor type — face
//   75 by default (the school can widen the list) — and an employeeNo, which is the student's code (STD-0001).
// - The device's own serialNo (with the device id) is the natural key of the event: a repeated push of the same event
//   is stored once. Events without a serialNo fall back to employeeNo + time.
// - dateTime carries the device's offset (NTP-synced device); without an offset it is read in the school time zone.
import { z } from "zod";
import { atSchoolTime, parseSchoolDate } from "@idrok/shared/time";

/** Minor event types that mean "verified" (ISAPI MINOR_* codes, decimal). 75 = face authentication passed. */
export const DEFAULT_ACCEPTED_SUB_EVENTS = [75] as const;

const AccessControllerEventSchema = z.looseObject({
  majorEventType: z.number().int().optional(),
  subEventType: z.number().int().optional(),
  employeeNoString: z.string().optional(),
  employeeNo: z.union([z.string(), z.number()]).optional(),
  serialNo: z.number().int().optional(),
  attendanceStatus: z.string().optional(),
  currentVerifyMode: z.string().optional(),
  name: z.string().optional(),
});

const EventSchema = z.looseObject({
  eventType: z.string(),
  dateTime: z.string().optional(),
  ipAddress: z.string().optional(),
  macAddress: z.string().optional(),
  AccessControllerEvent: AccessControllerEventSchema.optional(),
});

export type ParsedHikEvent =
  | { kind: "HEARTBEAT" }
  | { kind: "IGNORED"; reason: "NOT_ACCESS" | "NOT_VERIFIED" | "NO_PERSON" | "BAD_TIME" }
  | {
      kind: "ACCESS";
      occurredAt: Date;
      employeeNo: string;
      serialNo: number | null;
      attendanceStatus: string | null;
      majorEventType: number;
      subEventType: number;
    };

const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/;
const LOCAL_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

/** Device time → instant. With an offset it is exact; without one it is read as school wall-clock time. */
export function parseDeviceTime(value: string, tz: string): Date | null {
  if (OFFSET_RE.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = LOCAL_RE.exec(value);
  if (!m) return null;
  try {
    const base = atSchoolTime(parseSchoolDate(m[1]!), Number(m[2]) * 60 + Number(m[3]), tz);
    return new Date(base.getTime() + Number(m[4] ?? 0) * 1000);
  } catch {
    return null;
  }
}

/** Parses one event object. Throws only on input that is not an event at all (the webhook answers 400). */
export function parseHikEvent(
  raw: unknown,
  opts: { tz: string; acceptedSubEvents: readonly number[] },
): ParsedHikEvent {
  const ev = EventSchema.parse(raw);
  const type = ev.eventType.toLowerCase();
  if (type === "heartbeat") return { kind: "HEARTBEAT" };
  if (type !== "accesscontrollerevent" || !ev.AccessControllerEvent) return { kind: "IGNORED", reason: "NOT_ACCESS" };
  const a = ev.AccessControllerEvent;
  const employeeNo = (a.employeeNoString ?? (a.employeeNo !== undefined ? String(a.employeeNo) : "")).trim();
  if (a.majorEventType !== 5 || a.subEventType === undefined || !opts.acceptedSubEvents.includes(a.subEventType)) {
    return employeeNo ? { kind: "IGNORED", reason: "NOT_VERIFIED" } : { kind: "HEARTBEAT" };
  }
  if (!employeeNo) return { kind: "IGNORED", reason: "NO_PERSON" };
  const occurredAt = ev.dateTime ? parseDeviceTime(ev.dateTime, opts.tz) : null;
  if (!occurredAt) return { kind: "IGNORED", reason: "BAD_TIME" };
  return {
    kind: "ACCESS",
    occurredAt,
    employeeNo,
    serialNo: a.serialNo ?? null,
    attendanceStatus: a.attendanceStatus ?? null,
    majorEventType: a.majorEventType,
    subEventType: a.subEventType,
  };
}

/** Natural key of an access event on one device. */
export function eventKey(e: Extract<ParsedHikEvent, { kind: "ACCESS" }>): string {
  return e.serialNo !== null ? `sn:${e.serialNo}` : `emp:${e.employeeNo}:${e.occurredAt.toISOString()}`;
}

/** An event is accepted only when its time is near the server clock (device clock drift / replay guard). */
export function withinClockSkew(occurredAt: Date, now: Date, maxAheadSeconds: number, maxAgeDays: number): boolean {
  const diff = occurredAt.getTime() - now.getTime();
  return diff <= maxAheadSeconds * 1000 && -diff <= maxAgeDays * 86_400_000;
}

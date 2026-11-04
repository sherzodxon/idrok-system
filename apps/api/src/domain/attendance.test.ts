// School attendance from access events, lateness bands, attendance coins, device health and Hikvision event parsing.
// The database side (webhook, idempotency, records) is in apps/api/test/attendance-*.test.ts.
import { parseSchoolDate } from "@idrok/shared/time";
import { describe, expect, it } from "vitest";
import {
  attendanceAward,
  attendanceOutcome,
  bandFor,
  bandsOverlap,
  connectionStatus,
  dailyAttendance,
  eventDirection,
  isDayOver,
  type AccessPoint,
  type DayRules,
} from "./attendance";
import { eventKey, parseDeviceTime, parseHikEvent, withinClockSkew } from "./hikvision";

const TZ = "Asia/Tashkent";
// 2026-11-11 h:m in Tashkent (UTC+5).
const at = (h: number, m = 0, s = 0, d = 11) => new Date(Date.UTC(2026, 10, d, h - 5, m, s));
const BANDS = [
  { id: "b1", fromMinute: 1, toMinute: 3 },
  { id: "b2", fromMinute: 3, toMinute: 7 },
  { id: "b3", fromMinute: 7, toMinute: null },
];
const RULES: DayRules = {
  schoolDate: parseSchoolDate("2026-11-11"),
  startMinute: 8 * 60 + 30,
  endMinute: 13 * 60 + 30,
  graceMinutes: 0,
  bands: BANDS,
  tz: TZ,
};
const ev = (d: Date, direction: AccessPoint["direction"] = "IN"): AccessPoint => ({ at: d, direction });

describe("event direction", () => {
  it("IN / OUT cameras decide; a BOTH terminal uses the event status", () => {
    expect(eventDirection("IN", "checkOut")).toBe("IN");
    expect(eventDirection("OUT", null)).toBe("OUT");
    expect(eventDirection("BOTH", "checkIn")).toBe("IN");
    expect(eventDirection("BOTH", "checkOut")).toBe("OUT");
    expect(eventDirection("BOTH", "undefined")).toBeNull();
  });
});

describe("daily attendance", () => {
  it("first IN is the arrival, last OUT after it the departure; repeated scans change nothing", () => {
    const r = dailyAttendance(
      [ev(at(8, 25)), ev(at(8, 26)), ev(at(13, 35), "OUT"), ev(at(13, 31), "OUT"), ev(at(7, 0), "OUT")],
      RULES,
      true,
    );
    expect(r).toMatchObject({ status: "PRESENT", lateMinutes: 0, earlyLeaveMinutes: 0 });
    expect(r.firstInAt).toEqual(at(8, 25));
    expect(r.lastOutAt).toEqual(at(13, 35));
  });

  it("lateness in whole minutes from the shift start, with bands and grace", () => {
    expect(dailyAttendance([ev(at(8, 30, 59))], RULES, false).status).toBe("PRESENT");
    expect(dailyAttendance([ev(at(8, 32, 10))], RULES, false)).toMatchObject({
      status: "LATE",
      lateMinutes: 2,
      latenessBandId: "b1",
    });
    expect(dailyAttendance([ev(at(8, 33))], RULES, false).latenessBandId).toBe("b2");
    expect(dailyAttendance([ev(at(9, 30))], RULES, false)).toMatchObject({ lateMinutes: 60, latenessBandId: "b3" });
    expect(dailyAttendance([ev(at(8, 32))], { ...RULES, graceMinutes: 2 }, false).status).toBe("PRESENT");
    expect(dailyAttendance([ev(at(8, 33))], { ...RULES, graceMinutes: 2, bands: [] }, false)).toMatchObject({
      status: "LATE",
      latenessBandId: null,
    });
  });

  it("no arrival: not arrived yet during the day, absent once it is over; other days are ignored", () => {
    expect(dailyAttendance([ev(at(8, 0, 0, 10))], RULES, false).status).toBe("NOT_ARRIVED");
    expect(dailyAttendance([ev(at(13, 0), "OUT")], RULES, true).status).toBe("ABSENT");
  });

  it("early leave and a BOTH terminal without status", () => {
    const r = dailyAttendance([ev(at(8, 10), null), ev(at(11, 0), null), ev(at(12, 0), null)], RULES, true);
    expect(r).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 90 });
    expect(r.lastOutAt).toEqual(at(12, 0));
  });

  it("the school day ends at the shift end", () => {
    expect(isDayOver(RULES, at(13, 29))).toBe(false);
    expect(isDayOver(RULES, at(13, 30))).toBe(true);
  });
});

describe("lateness bands", () => {
  it("[from, to) and overlap check", () => {
    expect(bandFor(0, BANDS)).toBeNull();
    expect(bandFor(3, BANDS)?.id).toBe("b2");
    expect(bandsOverlap(BANDS)).toBe(false);
    expect(
      bandsOverlap([
        { fromMinute: 1, toMinute: 5 },
        { fromMinute: 4, toMinute: null },
      ]),
    ).toBe(true);
    expect(
      bandsOverlap([
        { fromMinute: 5, toMinute: null },
        { fromMinute: 1, toMinute: 3 },
      ]),
    ).toBe(false);
    expect(
      bandsOverlap([
        { fromMinute: 5, toMinute: null },
        { fromMinute: 6, toMinute: 8 },
      ]),
    ).toBe(true);
  });
});

describe("attendance coins", () => {
  const rules = [
    { outcome: "ON_TIME", amount: 1 },
    { outcome: "b2", amount: -1 },
  ];
  it("on time and lateness bands; nothing for a manual mark, absence or a band without a rule", () => {
    expect(attendanceAward(attendanceOutcome({ status: "PRESENT", latenessBandId: null }, null), rules)?.amount).toBe(
      1,
    );
    expect(attendanceAward(attendanceOutcome({ status: "LATE", latenessBandId: "b2" }, null), rules)?.amount).toBe(-1);
    expect(attendanceAward(attendanceOutcome({ status: "LATE", latenessBandId: "b1" }, null), rules)).toBeNull();
    expect(attendanceOutcome({ status: "PRESENT", latenessBandId: null }, "EXCUSED")).toBeNull();
    expect(attendanceOutcome({ status: "ABSENT", latenessBandId: null }, null)).toBeNull();
  });
});

describe("device health", () => {
  it("online within the stale window", () => {
    expect(connectionStatus(null, at(9), 120)).toBe("UNKNOWN");
    expect(connectionStatus(at(8, 58), at(9), 120)).toBe("ONLINE");
    expect(connectionStatus(at(8, 57), at(9), 120)).toBe("OFFLINE");
  });
});

describe("hikvision events", () => {
  const opts = { tz: TZ, acceptedSubEvents: [75] };
  const access = (over: Record<string, unknown> = {}, dateTime = "2026-11-11T08:29:12+05:00") => ({
    ipAddress: "192.168.1.64",
    dateTime,
    eventType: "AccessControllerEvent",
    AccessControllerEvent: {
      majorEventType: 5,
      subEventType: 75,
      employeeNoString: "STD-0001",
      serialNo: 1234,
      attendanceStatus: "checkIn",
      ...over,
    },
  });

  it("a verified face is an access event with the device time", () => {
    const e = parseHikEvent(access(), opts);
    expect(e).toMatchObject({ kind: "ACCESS", employeeNo: "STD-0001", serialNo: 1234, attendanceStatus: "checkIn" });
    if (e.kind === "ACCESS") {
      expect(e.occurredAt).toEqual(at(8, 29, 12));
      expect(eventKey(e)).toBe("sn:1234");
      expect(eventKey({ ...e, serialNo: null })).toBe(`emp:STD-0001:${at(8, 29, 12).toISOString()}`);
    }
  });

  it("heartbeats, failed verification and events without a person", () => {
    expect(parseHikEvent({ eventType: "heartBeat" }, opts)).toEqual({ kind: "HEARTBEAT" });
    expect(parseHikEvent(access({ subEventType: 76 }), opts)).toEqual({ kind: "IGNORED", reason: "NOT_VERIFIED" });
    expect(parseHikEvent(access({ subEventType: 21, employeeNoString: undefined }), opts)).toEqual({
      kind: "HEARTBEAT",
    });
    expect(parseHikEvent(access({ employeeNoString: " " }), opts)).toEqual({ kind: "IGNORED", reason: "NO_PERSON" });
    expect(parseHikEvent({ eventType: "videoloss" }, opts)).toEqual({ kind: "IGNORED", reason: "NOT_ACCESS" });
    expect(parseHikEvent(access({}, "yesterday"), opts)).toEqual({ kind: "IGNORED", reason: "BAD_TIME" });
    expect(() => parseHikEvent({ nope: 1 }, opts)).toThrow();
  });

  it("device time without an offset is school wall-clock time", () => {
    expect(parseDeviceTime("2026-11-11T08:29:12", TZ)).toEqual(at(8, 29, 12));
    expect(parseDeviceTime("2026-11-11T03:29:12Z", TZ)).toEqual(at(8, 29, 12));
  });

  it("clock skew guard", () => {
    expect(withinClockSkew(at(9, 1), at(9), 300, 7)).toBe(true);
    expect(withinClockSkew(at(9, 10), at(9), 300, 7)).toBe(false);
    expect(withinClockSkew(at(9, 0, 0, 1), at(9), 300, 7)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { atSchoolTime, parseSchoolDate } from "@idrok/shared/time";
import { attendanceRate, deferForQuietHours, effectiveQuietHours, isBelowThreshold, isQuietMinute } from "./notifications";

const TZ = "Asia/Tashkent";
const day = parseSchoolDate("2026-11-10");
const night = { startMinute: 22 * 60, endMinute: 7 * 60 };

describe("quiet hours", () => {
  it("a window across midnight", () => {
    expect(isQuietMinute(23 * 60, night)).toBe(true);
    expect(isQuietMinute(6 * 60 + 59, night)).toBe(true);
    expect(isQuietMinute(7 * 60, night)).toBe(false);
    expect(isQuietMinute(12 * 60, { startMinute: 12 * 60, endMinute: 12 * 60 })).toBe(false);
  });

  it("defers to the end of the window, the next morning before midnight", () => {
    expect(deferForQuietHours(atSchoolTime(day, 23 * 60, TZ), night, TZ)).toEqual(
      atSchoolTime(parseSchoolDate("2026-11-11"), 7 * 60, TZ),
    );
    expect(deferForQuietHours(atSchoolTime(day, 3 * 60, TZ), night, TZ)).toEqual(atSchoolTime(day, 7 * 60, TZ));
    const noon = atSchoolTime(day, 12 * 60, TZ);
    expect(deferForQuietHours(noon, night, TZ)).toBe(noon);
    expect(deferForQuietHours(atSchoolTime(day, 23 * 60, TZ), null, TZ)).toEqual(atSchoolTime(day, 23 * 60, TZ));
  });

  it("the guardian's own window or none wins over the school's", () => {
    expect(effectiveQuietHours(night, null)).toBe(night);
    expect(effectiveQuietHours(night, { quietStartMinute: null, quietEndMinute: null, quietHoursOff: true })).toBeNull();
    expect(effectiveQuietHours(night, { quietStartMinute: 60, quietEndMinute: 120, quietHoursOff: false })).toEqual({
      startMinute: 60,
      endMinute: 120,
    });
  });
});

it("attendance rate in exact decimals", () => {
  expect(attendanceRate(0, 0)).toBeNull();
  expect(attendanceRate(3, 2)!.toString()).toBe("66.67");
  expect(isBelowThreshold(attendanceRate(20, 15), "80")).toBe(true);
  expect(isBelowThreshold(attendanceRate(20, 16), "80.00")).toBe(false);
  expect(isBelowThreshold(null, "80")).toBe(false);
});

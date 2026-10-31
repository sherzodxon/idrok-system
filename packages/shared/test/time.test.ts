// Run under TZ=UTC and TZ=Asia/Tashkent (CI matrix): results must not depend on the process timezone.
import { describe, expect, it } from "vitest";
import {
  addSchoolDays,
  atSchoolTime,
  diffSchoolDays,
  eachSchoolDate,
  formatTimeOfDay,
  isSchoolDate,
  isoWeekday,
  monthRange,
  parseSchoolDate,
  parseTimeOfDay,
  schoolDateFromDb,
  schoolDateToDb,
  schoolDayRange,
  startOfSchoolDay,
  toSchoolDate,
  weekRange,
  type SchoolDate,
} from "../src/time";

const d = (s: string) => parseSchoolDate(s);
const at = (iso: string) => new Date(iso);

describe("toSchoolDate (Asia/Tashkent, UTC+5)", () => {
  it("23:30 Tashkent stays on the same day", () => {
    // 2026-10-30 23:30 Tashkent = 18:30 UTC
    expect(toSchoolDate(at("2026-10-30T18:30:00Z"))).toBe("2026-10-30");
  });

  it("00:30 Tashkent is already the next day although UTC still says the previous one", () => {
    // 2026-10-31 00:30 Tashkent = 2026-10-30 19:30 UTC — the bug EdexTest had (setHours in UTC)
    expect(toSchoolDate(at("2026-10-30T19:30:00Z"))).toBe("2026-10-31");
  });

  it("04:59 Tashkent belongs to the Tashkent day, not the UTC one", () => {
    expect(toSchoolDate(at("2026-10-30T23:59:00Z"))).toBe("2026-10-31");
  });

  it("other zones work too", () => {
    expect(toSchoolDate(at("2026-10-30T19:30:00Z"), "UTC")).toBe("2026-10-30");
  });
});

describe("day boundaries", () => {
  it("start of a Tashkent day is 19:00 UTC of the previous day", () => {
    expect(startOfSchoolDay(d("2026-10-31")).toISOString()).toBe("2026-10-30T19:00:00.000Z");
  });

  it("schoolDayRange is [start, end) of 24h", () => {
    const { start, end } = schoolDayRange(d("2026-10-31"));
    expect(end.getTime() - start.getTime()).toBe(86_400_000);
    expect(toSchoolDate(start)).toBe("2026-10-31");
    expect(toSchoolDate(new Date(end.getTime() - 1))).toBe("2026-10-31");
    expect(toSchoolDate(end)).toBe("2026-11-01");
  });

  it("atSchoolTime turns a bell time into an instant", () => {
    expect(atSchoolTime(d("2026-09-02"), parseTimeOfDay("08:30")).toISOString()).toBe("2026-09-02T03:30:00.000Z");
  });

  it("handles a DST zone (Europe/Berlin, spring forward)", () => {
    // 2026-03-29: clocks go 02:00 → 03:00; 12:00 local is UTC+2
    expect(atSchoolTime(d("2026-03-29"), 12 * 60, "Europe/Berlin").toISOString()).toBe("2026-03-29T10:00:00.000Z");
  });
});

describe("calendar arithmetic", () => {
  it("validates dates", () => {
    expect(isSchoolDate("2026-02-29")).toBe(false);
    expect(isSchoolDate("2028-02-29")).toBe(true);
    expect(isSchoolDate("2026-1-5")).toBe(false);
    expect(() => parseSchoolDate("31.10.2026")).toThrow(RangeError);
  });

  it("adds and diffs days across month and year ends", () => {
    expect(addSchoolDays(d("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addSchoolDays(d("2026-03-01"), -1)).toBe("2026-02-28");
    expect(diffSchoolDays(d("2026-09-01"), d("2027-06-30"))).toBe(302);
  });

  it("knows ISO weekdays", () => {
    expect(isoWeekday(d("2026-10-31"))).toBe(6); // Saturday
    expect(isoWeekday(d("2026-11-02"))).toBe(1); // Monday
    expect(isoWeekday(d("2026-11-01"))).toBe(7); // Sunday
  });

  it("weekRange starts on Monday by default", () => {
    expect(weekRange(d("2026-11-01"))).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(weekRange(d("2026-10-26"))).toEqual({ from: "2026-10-26", to: "2026-11-01" });
  });

  it("monthRange covers leap February", () => {
    expect(monthRange(d("2028-02-10"))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange(d("2026-12-31"))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("iterates inclusive ranges", () => {
    expect([...eachSchoolDate(d("2026-10-30"), d("2026-11-02"))]).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });
});

describe("time of day and db adapter", () => {
  it("parses and formats bell times", () => {
    expect(parseTimeOfDay("08:30")).toBe(510);
    expect(formatTimeOfDay(510)).toBe("08:30");
    expect(() => parseTimeOfDay("24:00")).toThrow(RangeError);
  });

  it("round-trips through the @db.Date representation", () => {
    const value: SchoolDate = d("2026-10-31");
    expect(schoolDateToDb(value).toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(schoolDateFromDb(schoolDateToDb(value))).toBe(value);
  });
});

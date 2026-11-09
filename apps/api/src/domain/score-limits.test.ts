import { parseSchoolDate } from "@idrok/shared/time";
import { describe, expect, it } from "vitest";
import {
  applicableRules,
  checkLimits,
  criterionBoundsError,
  remainingToday,
  sessionMaxPoints,
  type EntryScope,
  type LimitRule,
} from "./score-limits";

const settings = { hardCapPerLesson: 10, hardCapPerDay: 50, lessonMaxPoints: 10 };
const entry = (patch: Partial<EntryScope> = {}): EntryScope => ({
  lessonSessionId: "s1",
  schoolDate: parseSchoolDate("2026-11-04"),
  periodId: "q2",
  subjectId: "math",
  teacherId: "t1",
  gradeId: "g7",
  teachingGroupId: "7a",
  criterionId: null,
  ...patch,
});
const n = (v: unknown) => Number(v);

describe("score limits (§3.1)", () => {
  it("19: a SUBJECT rule for maths overrides the SUBJECT default; other subjects keep the default", () => {
    const rules: LimitRule[] = [
      { window: "DAY", scopeType: "SUBJECT", scopeId: null, maxPoints: 10 },
      { window: "DAY", scopeType: "SUBJECT", scopeId: "math", maxPoints: 20 },
    ];
    expect(applicableRules(rules, entry()).map((r) => r.maxPoints)).toEqual([20]);
    expect(applicableRules(rules, entry({ subjectId: "bio" })).map((r) => r.maxPoints)).toEqual([10]);
    // Maths: 18 already in other lessons today, 2 more fit, 3 do not.
    const existing = [
      { ...entry({ lessonSessionId: "a" }), points: 9 },
      { ...entry({ lessonSessionId: "b" }), points: 9 },
    ];
    expect(checkLimits(rules, settings, existing, entry(), 2)).toBeNull();
    expect(checkLimits(rules, settings, existing, entry(), 3)).toMatchObject({
      window: "DAY",
      scopeType: "SUBJECT",
    });
    const bio = [{ ...entry({ lessonSessionId: "c", subjectId: "bio" }), points: 9 }];
    expect(checkLimits(rules, settings, bio, entry({ subjectId: "bio" }), 2)).toMatchObject({ scopeType: "SUBJECT" });
  });

  it("20: no rule raises the hard caps", () => {
    const generous: LimitRule[] = [
      { window: "DAY", scopeType: "GLOBAL", scopeId: null, maxPoints: 500 },
      { window: "LESSON", scopeType: "GLOBAL", scopeId: null, maxPoints: 100 },
    ];
    const day = Array.from({ length: 5 }, (_, i) => ({ ...entry({ lessonSessionId: `x${i}` }), points: 9 }));
    const v = checkLimits(generous, settings, day, entry(), 6);
    expect(v).toMatchObject({ window: "DAY", scopeType: "HARD_CAP" });
    expect([n(v!.max), n(v!.used), n(v!.remaining)]).toEqual([50, 45, 5]);
    expect(checkLimits(generous, settings, [], entry(), 11)).toMatchObject({ window: "LESSON", scopeType: "HARD_CAP" });
    expect(n(sessionMaxPoints(generous, settings, entry()))).toBe(10);
  });

  it("reversals give the points back; other teachers' entries count", () => {
    const existing = [
      { ...entry({ teacherId: "t2" }), points: 8 },
      { ...entry({ teacherId: "t2" }), points: -8 },
      { ...entry({ teacherId: "t2" }), points: 6 },
    ];
    expect(checkLimits([], settings, existing, entry(), 4)).toBeNull();
    expect(checkLimits([], settings, existing, entry(), 5)).toMatchObject({
      window: "LESSON",
      remaining: expect.anything(),
    });
  });

  it("week, month and period windows; the session maximum from the tightest LESSON rule", () => {
    const rules: LimitRule[] = [
      { window: "WEEK", scopeType: "GLOBAL", scopeId: null, maxPoints: 30 },
      { window: "LESSON", scopeType: "SUBJECT", scopeId: "math", maxPoints: 5 },
      { window: "LESSON", scopeType: "TEACHER", scopeId: null, maxPoints: 8 },
    ];
    const monday = { ...entry({ lessonSessionId: "m", schoolDate: parseSchoolDate("2026-11-02") }), points: 26 };
    const lastWeek = { ...entry({ lessonSessionId: "l", schoolDate: parseSchoolDate("2026-10-31") }), points: 25 };
    expect(checkLimits(rules, settings, [lastWeek], entry(), 5)).toBeNull();
    expect(checkLimits(rules, settings, [monday], entry(), 5)?.window).toBe("WEEK");
    expect(n(sessionMaxPoints(rules, settings, entry()))).toBe(5);
    expect(n(sessionMaxPoints(rules, settings, entry({ subjectId: "bio" })))).toBe(8);
    expect(n(remainingToday(rules, settings, [monday], entry()))).toBe(50);
  });
});

describe("criterion limits and bounds (T-77)", () => {
  it("a CRITERION rule counts only entries under the same criterion; its default applies per criterion", () => {
    const rules: LimitRule[] = [
      { window: "DAY", scopeType: "CRITERION", scopeId: null, maxPoints: 6 },
      { window: "DAY", scopeType: "CRITERION", scopeId: "activity", maxPoints: 4 },
    ];
    const activity = entry({ criterionId: "activity" });
    const homework = entry({ criterionId: "homework" });
    const existing = [
      { ...entry({ lessonSessionId: "a", criterionId: "activity" }), points: 3 },
      { ...entry({ lessonSessionId: "a", criterionId: "homework" }), points: 5 },
    ];
    // Activity: 3 used of its own 4.
    expect(checkLimits(rules, settings, existing, activity, 1)).toBeNull();
    expect(checkLimits(rules, settings, existing, activity, 2)).toMatchObject({
      window: "DAY",
      scopeType: "CRITERION",
      remaining: expect.anything(),
    });
    // Homework: the default 6, the activity points do not count.
    expect(checkLimits(rules, settings, existing, homework, 1)).toBeNull();
    expect(checkLimits(rules, settings, existing, homework, 2)?.scopeType).toBe("CRITERION");
    // An entry without a criterion is not under any criterion rule.
    expect(applicableRules(rules, entry())).toEqual([]);
  });

  it("reversed points free the criterion limit again", () => {
    const rules: LimitRule[] = [{ window: "DAY", scopeType: "CRITERION", scopeId: "activity", maxPoints: 4 }];
    const existing = [
      { ...entry({ lessonSessionId: "a", criterionId: "activity" }), points: 4 },
      { ...entry({ lessonSessionId: "a", criterionId: "activity" }), points: -4 },
    ];
    expect(checkLimits(rules, settings, existing, entry({ criterionId: "activity" }), 4)).toBeNull();
  });

  it("bounds of one entry", () => {
    expect(criterionBoundsError(3, { minPoints: 1, maxPoints: 4 })).toBeNull();
    expect(criterionBoundsError("4.5", { minPoints: 1, maxPoints: "4" })).toMatchObject({ bound: "max" });
    expect(criterionBoundsError("0.5", { minPoints: 1, maxPoints: null })).toMatchObject({ bound: "min" });
    expect(criterionBoundsError(100, { minPoints: null, maxPoints: null })).toBeNull();
  });
});

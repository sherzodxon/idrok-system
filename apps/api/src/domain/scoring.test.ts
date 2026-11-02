// docs/spec/scoring.md §10: acceptance 1–15 (16 — a closed period's snapshot — is an API test in step 6).
import { DEFAULT_ASSESSMENT_CONFIG as DEFAULTS, type AssessmentConfig } from "@idrok/shared";
import type { Decimal } from "@idrok/shared/decimal";
import { D } from "@idrok/shared/decimal";
import { describe, expect, it } from "vitest";
import {
  gradeLabel,
  gradeScaleProblems,
  higherPeriodPercent,
  overallPercent,
  periodResult,
  policyProblems,
  roundTo,
  sessionOutcome,
  tally,
  testsPercent,
  type StudentSession,
} from "./scoring";

const n = (d: Decimal | null | undefined) => (d === null || d === undefined ? d : d.toNumber());
let id = 0;
const scored = (points: number): StudentSession => ({
  cancelled: false,
  started: true,
  maxPoints: 10,
  attendance: null,
  entries: [{ id: `e${++id}`, kind: "NORMAL", points, reversesEntryId: null }],
});
const ungraded = (patch: Partial<StudentSession> = {}): StudentSession => ({
  cancelled: false,
  started: true,
  maxPoints: 10,
  attendance: null,
  entries: [],
  ...patch,
});
const outcomes = (sessions: StudentSession[], policy: Partial<AssessmentConfig> = {}) =>
  sessions.map((s) => sessionOutcome(s, { ...DEFAULTS, ...policy }));
const bands = [
  { minPercent: "0", maxPercent: "56", label: "2" },
  { minPercent: "56", maxPercent: "71", label: "3" },
  { minPercent: "71", maxPercent: "86", label: "4" },
  { minPercent: "86", maxPercent: "100", label: "5" },
];

describe("daily aggregation (§4)", () => {
  it("1: 5 sessions × 10, 45 earned → POOLED 90%", () => {
    const math = tally(outcomes([9, 9, 9, 9, 9].map(scored)));
    expect(n(math.percent)).toBe(90);
    expect(n(overallPercent(DEFAULTS, new Map([["m", math]])))).toBe(90);
  });

  it("2: BY_SUBJECT mode gives no overall percent", () => {
    const math = tally(outcomes([scored(9)]));
    expect(overallPercent({ ...DEFAULTS, dailyView: "BY_SUBJECT" }, new Map([["m", math]]))).toBeUndefined();
  });

  it("3: WEIGHTED_SUBJECTS 80% (1.5), 90% (1), null (1) → 84%", () => {
    const t = (percent: number | null) => ({ earned: D(0), max: D(0), percent: percent === null ? null : D(percent) });
    const policy = {
      ...DEFAULTS,
      overallMethod: "WEIGHTED_SUBJECTS" as const,
      subjectWeights: { a: "1.5", b: "1", c: "1" },
    };
    expect(
      n(
        overallPercent(
          policy,
          new Map([
            ["a", t(80)],
            ["b", t(90)],
            ["c", t(null)],
          ]),
        ),
      ),
    ).toBe(84);
  });

  it("4: an ungraded session is PENDING and does not change the percent", () => {
    const o = outcomes([scored(9), ungraded()]);
    expect(o[1]!.state).toBe("PENDING");
    expect(n(tally(o).percent)).toBe(90);
    // Nothing graded at all: no result, not 0%.
    expect(tally(outcomes([ungraded()])).percent).toBeNull();
  });

  it("5: ungradedPresentAs = ZERO → the session counts as 0/10", () => {
    expect(n(tally(outcomes([scored(9), ungraded()], { ungradedPresentAs: "ZERO" })).percent)).toBe(45);
  });

  it("6: a cancelled session is left out of the maximum", () => {
    const o = outcomes([scored(9), ungraded({ cancelled: true })], { ungradedPresentAs: "ZERO" });
    expect(o[1]!.state).toBe("CANCELLED");
    expect(n(tally(o).max)).toBe(10);
  });

  it("7: absentUnexcused ZERO → 0/10, EXCLUDE → left out", () => {
    const absent = ungraded({ attendance: "ABSENT_UNEXCUSED" });
    expect(n(tally(outcomes([scored(9), absent], { absentUnexcused: "ZERO" })).percent)).toBe(45);
    expect(n(tally(outcomes([scored(9), absent], { absentUnexcused: "EXCLUDE" })).percent)).toBe(90);
    expect(n(tally(outcomes([scored(9), ungraded({ attendance: "ABSENT_EXCUSED" })])).percent)).toBe(90);
  });

  it("future sessions and fully reversed entries are not counted (T-40)", () => {
    const reversedOut: StudentSession = {
      ...ungraded(),
      entries: [
        { id: "x", kind: "NORMAL", points: 5, reversesEntryId: null },
        { id: "y", kind: "REVERSAL", points: -5, reversesEntryId: "x" },
      ],
    };
    const corrected: StudentSession = {
      ...reversedOut,
      entries: [...reversedOut.entries, { id: "z", kind: "NORMAL", points: 7, reversesEntryId: null }],
    };
    const o = outcomes([ungraded({ started: false }), reversedOut, corrected]);
    expect(o.map((x) => x.state)).toEqual(["UPCOMING", "PENDING", "SCORED"]);
    expect(n(o[2]!.earned)).toBe(7);
  });
});

describe("period result (§5)", () => {
  const inputs = (daily: number | null, tests: number | null) => ({
    daily: daily === null ? null : D(daily),
    tests: tests === null ? null : D(tests),
    manual: new Map(),
  });

  it("8: daily 88% × 50 = 44, tests 86% × 50 = 43 → 87/100", () => {
    const r = periodResult(DEFAULTS, inputs(88, 86));
    expect(r.components.map((c) => n(c.points))).toEqual([44, 43]);
    expect([n(r.total), n(r.maxPoints), n(r.percent)]).toEqual([87, 100, 87]);
  });

  it("9: test weights 80% (1) and 95% (2) → 90%", () => {
    expect(
      n(
        testsPercent(
          [
            { weight: 1, attempts: [80] },
            { weight: 2, attempts: [95] },
          ],
          DEFAULTS,
        ),
      ),
    ).toBe(90);
  });

  it("missed tests and retakes follow the policy", () => {
    const tests = [
      { weight: 1, attempts: [60, 90] },
      { weight: 1, attempts: [] },
    ];
    expect(n(testsPercent(tests, DEFAULTS))).toBe(90); // LAST, missed EXCLUDE
    expect(n(testsPercent(tests, { missedTest: "ZERO", retakePolicy: "LAST" }))).toBe(45);
    expect(n(testsPercent([{ weight: 1, attempts: [90, 60] }], { ...DEFAULTS, retakePolicy: "BEST" }))).toBe(90);
    expect(testsPercent([], DEFAULTS)).toBeNull();
    // The test's own retake rule wins; a pending test (open window, excused) never counts, even with ZERO.
    expect(n(testsPercent([{ weight: 1, attempts: [90, 60], retakePolicy: "BEST" }], DEFAULTS))).toBe(90);
    expect(
      n(testsPercent([{ weight: 1, attempts: [90, 60], retakePolicy: "LAST" }], { ...DEFAULTS, retakePolicy: "BEST" })),
    ).toBe(60);
    const zero = { missedTest: "ZERO" as const, retakePolicy: "LAST" as const };
    expect(
      n(
        testsPercent(
          [
            { weight: 1, attempts: [80] },
            { weight: 1, attempts: [], pending: true },
          ],
          zero,
        ),
      ),
    ).toBe(80);
  });

  it("10: no test, REDISTRIBUTE: daily 88% → 88/100; PENDING → no result", () => {
    const r = periodResult(DEFAULTS, inputs(88, null));
    expect([n(r.total), n(r.percent), r.complete]).toEqual([88, 88, true]);
    const pending = periodResult({ ...DEFAULTS, emptyComponent: "PENDING" }, inputs(88, null));
    expect([pending.complete, pending.total]).toEqual([false, null]);
    const zero = periodResult({ ...DEFAULTS, emptyComponent: "ZERO" }, inputs(88, null));
    expect(n(zero.total)).toBe(44);
    expect(periodResult(DEFAULTS, inputs(null, null)).complete).toBe(false);
  });

  it("MANUAL components and SEPARATE tests", () => {
    const config = {
      ...DEFAULTS,
      components: [
        { key: "daily", type: "DAILY_SCORES" as const, name: "D", maxPoints: "60", enabled: true },
        { key: "oral", type: "MANUAL" as const, name: "O", maxPoints: "40", enabled: true },
      ],
      testsMode: "SEPARATE" as const,
    };
    const r = periodResult(config, {
      daily: D(90),
      tests: D(10),
      manual: new Map([["oral", { earned: 15, max: 20 }]]),
    });
    expect(n(r.total)).toBe(84); // 54 + 30
  });

  it("11: components 50 + 40 ≠ 100 → publish refused", () => {
    const bad = {
      ...DEFAULTS,
      components: [DEFAULTS.components[0]!, { ...DEFAULTS.components[1]!, maxPoints: "40" }],
    };
    expect(policyProblems(bad)).toContain("COMPONENTS_SUM_MISMATCH");
    expect(policyProblems(DEFAULTS)).toEqual([]);
    expect(policyProblems({ ...DEFAULTS, testsMode: "SEPARATE" })).toContain("TESTS_COMPONENT_IN_SEPARATE_MODE");
    expect(policyProblems({ ...DEFAULTS, higherDefault: { aggregation: "WEIGHTED" } })).toContain(
      "HIGHER_WEIGHTS_MISSING",
    );
  });

  it("12: half-year WEIGHTED 40/60 of 80% and 90% → 86%", () => {
    const rule = { aggregation: "WEIGHTED" as const, weights: { q1: 40, q2: 60 } };
    const children = [
      { periodId: "q1", percent: D(80) },
      { periodId: "q2", percent: D(90) },
    ];
    expect(n(higherPeriodPercent(rule, children))).toBe(86);
    expect(n(higherPeriodPercent({ aggregation: "AVERAGE" }, children))).toBe(85);
    const withFinal = {
      aggregation: "WEIGHTED_WITH_FINAL" as const,
      weights: { q1: 1, q2: 1 },
      finalComponent: { key: "f", weight: 2 },
    };
    expect(n(higherPeriodPercent(withFinal, children, D(70)))).toBe(77.5);
  });

  it("13: HALF_UP 0: 86.5 → 87, FLOOR → 86; intermediate values stay exact", () => {
    expect(n(roundTo("86.5", { mode: "HALF_UP", decimals: 0 }))).toBe(87);
    expect(n(roundTo("86.5", { mode: "FLOOR", decimals: 0 }))).toBe(86);
    // 1/3 of the way: the total keeps every digit until it is shown.
    const r = periodResult(DEFAULTS, { daily: D(100).div(3), tests: D(100).div(3), manual: new Map() });
    expect(r.total!.toString()).toMatch(/^33\.3333333/);
  });

  it("14: 86 → 5, 85.99 → 4 with bands 86–100 / 71–86", () => {
    expect(gradeLabel(bands, 86)).toBe("5");
    expect(gradeLabel(bands, "85.99")).toBe("4");
    expect(gradeLabel(bands, 100)).toBe("5");
    expect(gradeLabel(bands, 0)).toBe("2");
  });

  it("15: a gap between bands → publish refused", () => {
    expect(gradeScaleProblems(bands)).toEqual([]);
    const gap = bands.map((b) => (b.label === "4" ? { ...b, minPercent: "72" } : b));
    expect(gradeScaleProblems(gap)).toContain("GAP_OR_OVERLAP");
    expect(gradeScaleProblems(bands.slice(1))).toContain("NOT_FROM_0_TO_100");
  });
});

// docs/spec/tests.md §10: the pure parts of acceptance 3, 6 (deadline), 7, 10, 11, 18 (visibility rule); the rest are
// API tests (apps/api/test/tests-*.test.ts).
import type { Decimal } from "@idrok/shared/decimal";
import { describe, expect, it } from "vitest";
import {
  answerProblem,
  attemptDeadline,
  attemptScore,
  contentHash,
  countsAsViolation,
  gradeAnswer,
  isPastDeadline,
  normalizeText,
  questionProblems,
  resultVisibility,
  seededShuffle,
  selectFromPool,
  summarize,
  topicMastery,
  violationLimitReached,
  windowState,
  type GradableQuestion,
  type SeenEvent,
} from "./tests";

// UTC instants on 2026-11-10.
const utc = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 10, h, m));
const n = (d: Decimal | null | undefined) => (d === null || d === undefined ? d : d.toNumber());
const opts = (correct: string[], ids = ["a", "b", "c", "d"]) =>
  ids.map((id) => ({ id, text: id.toUpperCase(), isCorrect: correct.includes(id) }));
const single: GradableQuestion = { type: "SINGLE", options: opts(["b"]) };
const multiple: GradableQuestion = { type: "MULTIPLE", options: opts(["a", "b", "c"], ["a", "b", "c", "d", "e"]) };
const matching: GradableQuestion = {
  type: "MATCHING",
  options: [],
  pairs: [
    { leftId: "l1", left: "2+2", rightId: "r1", right: "4" },
    { leftId: "l2", left: "3+3", rightId: "r2", right: "6" },
    { leftId: "l3", left: "1+1", rightId: "r3", right: "2" },
    { leftId: "l4", left: "5+5", rightId: "r4", right: "10" },
  ],
};

describe("grading (§4.6)", () => {
  it("SINGLE: the right option gets full points, anything else 0", () => {
    expect(gradeAnswer(single, { optionIds: ["b"] }, 2)).toMatchObject({ isCorrect: true });
    expect(n(gradeAnswer(single, { optionIds: ["b"] }, 2).points)).toBe(2);
    expect(n(gradeAnswer(single, { optionIds: ["a"] }, 2).points)).toBe(0);
    expect(n(gradeAnswer(single, null, 2).points)).toBe(0);
    expect(n(gradeAnswer(single, { text: "b" }, 2).points)).toBe(0);
  });

  it("acceptance 10: MULTIPLE PARTIAL — 2 of 3 right + 1 wrong → (2 − 1) / 3", () => {
    const g = gradeAnswer(multiple, { optionIds: ["a", "b", "d"] }, 3, "PARTIAL");
    expect(g.isCorrect).toBe(false);
    expect(n(g.points)).toBe(1);
    expect(n(gradeAnswer(multiple, { optionIds: ["a", "b", "d"] }, 3).points)).toBe(0); // ALL_OR_NOTHING
    expect(n(gradeAnswer(multiple, { optionIds: ["a", "d", "e"] }, 3, "PARTIAL").points)).toBe(0); // never negative
    expect(gradeAnswer(multiple, { optionIds: ["c", "b", "a"] }, 3)).toMatchObject({ isCorrect: true });
  });

  it("acceptance 11: SHORT_TEXT accepts apostrophe, case and space variants", () => {
    const q: GradableQuestion = { type: "SHORT_TEXT", options: [], acceptedAnswers: ["O‘zbekiston"] };
    for (const text of ["O‘zbekiston", "o'zbekiston ", "O`zbekiston", "  oʻzbekiston", "O’ZBEKISTON"]) {
      expect(gradeAnswer(q, { text }, 1).isCorrect, text).toBe(true);
    }
    expect(gradeAnswer(q, { text: "Ozbekiston" }, 1).isCorrect).toBe(false);
    expect(gradeAnswer(q, { text: "  " }, 1).isCorrect).toBe(false);
    expect(normalizeText("Toshkent   shahri")).toBe("toshkent shahri");
  });

  it("MATCHING: points per right pair; a left side counted once", () => {
    const g = gradeAnswer(
      matching,
      {
        pairs: [
          { leftId: "l1", rightId: "r1" },
          { leftId: "l2", rightId: "r3" },
          { leftId: "l3", rightId: "r3" },
          { leftId: "l1", rightId: "r1" },
        ],
      },
      2,
    );
    expect(n(g.points)).toBe(1); // 2 of 4 pairs × 2 points
    expect(g.isCorrect).toBe(false);
  });

  it("attempt score and percent", () => {
    const s = attemptScore([
      { points: 2, awarded: 2 },
      { points: 3, awarded: 1 },
      { points: 5, awarded: 0 },
    ]);
    expect([n(s.score), n(s.maxScore), n(s.percent)]).toEqual([3, 10, 30]);
    expect(attemptScore([]).percent).toBeNull();
  });
});

describe("answer and question checks (S5, §4.1)", () => {
  it("acceptance 17 (shape): another question's option, two options on SINGLE, wrong kind → a problem", () => {
    expect(answerProblem(single, { optionIds: ["b"] })).toBeNull();
    expect(answerProblem(single, { optionIds: [] })).toBeNull(); // clearing the answer
    expect(answerProblem(single, { optionIds: ["zz"] })).toBe("UNKNOWN_OPTION");
    expect(answerProblem(single, { optionIds: ["a", "b"] })).toBe("SINGLE_EXPECTS_ONE");
    expect(answerProblem(multiple, { optionIds: ["a", "a"] })).toBe("DUPLICATE");
    expect(answerProblem(single, { text: "b" })).toBe("WRONG_KIND");
    expect(answerProblem(matching, { pairs: [{ leftId: "l1", rightId: "x" }] })).toBe("UNKNOWN_OPTION");
    expect(answerProblem(matching, { pairs: [{ leftId: "l1", rightId: "r1" }] })).toBeNull();
  });

  it("well-formed questions", () => {
    expect(questionProblems({ ...single, text: "?" })).toEqual([]);
    expect(questionProblems({ type: "SINGLE", text: "?", options: opts(["a", "b"]) })).toEqual([
      "SINGLE_NEEDS_ONE_CORRECT",
    ]);
    expect(questionProblems({ type: "MULTIPLE", text: "?", options: opts([]) })).toEqual(["MULTIPLE_NEEDS_CORRECT"]);
    expect(questionProblems({ type: "SINGLE", text: " ", options: opts(["a"], ["a"]) })).toEqual([
      "EMPTY_TEXT",
      "TOO_FEW_OPTIONS",
    ]);
    expect(questionProblems({ type: "SHORT_TEXT", text: "?", options: [], acceptedAnswers: [" "] })).toEqual([
      "NO_ACCEPTED_ANSWERS",
    ]);
    expect(questionProblems({ ...matching, text: "?", pairs: matching.pairs!.slice(0, 1) })).toEqual(["TOO_FEW_PAIRS"]);
  });

  it("content hash ignores case, apostrophes and option order", () => {
    const a = contentHash({
      type: "SINGLE",
      text: "O‘zbekiston poytaxti?",
      options: [{ text: "Toshkent" }, { text: "Samarqand" }],
    });
    const b = contentHash({
      type: "SINGLE",
      text: "o'zbekiston  poytaxti?",
      options: [{ text: "samarqand" }, { text: "TOSHKENT" }],
    });
    const c = contentHash({
      type: "SINGLE",
      text: "O'zbekiston poytaxti?",
      options: [{ text: "Buxoro" }, { text: "Toshkent" }],
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("order (§4.2, acceptance 3)", () => {
  const items = Array.from({ length: 20 }, (_, i) => `q${i}`);
  it("the same seed gives the same order; another seed another one; nothing lost", () => {
    expect(seededShuffle(items, "attempt-1")).toEqual(seededShuffle(items, "attempt-1"));
    expect(seededShuffle(items, "attempt-1")).not.toEqual(seededShuffle(items, "attempt-2"));
    expect([...seededShuffle(items, "x")].sort()).toEqual([...items].sort());
  });

  it("pool rules: per topic and difficulty, no repeats, null when a rule cannot be filled", () => {
    const pool = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `loop${i}`, topicId: "loops", difficulty: "EASY" as const })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `arr${i}`, topicId: "arrays", difficulty: "HARD" as const })),
    ];
    const chosen = selectFromPool(
      [
        { topicId: "loops", difficulty: null, count: 5 },
        { topicId: null, difficulty: "HARD", count: 3 },
      ],
      pool,
      "seed",
    )!;
    expect(chosen).toHaveLength(8);
    expect(new Set(chosen).size).toBe(8);
    expect(chosen.slice(0, 5).every((id) => id.startsWith("loop"))).toBe(true);
    expect(chosen.slice(5).every((id) => id.startsWith("arr"))).toBe(true);
    expect(selectFromPool([{ topicId: "arrays", difficulty: null, count: 5 }], pool, "s")).toBeNull();
  });
});

describe("window and deadline (§4.2)", () => {
  const at = (hhmm: string) => utc(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)));
  it("deadline = min(start + limit, window end)", () => {
    expect(attemptDeadline(at("09:00"), { endsAt: at("10:00"), timeLimitMinutes: 40 })).toEqual(at("09:40"));
    expect(attemptDeadline(at("09:30"), { endsAt: at("10:00"), timeLimitMinutes: 40 })).toEqual(at("10:00"));
    expect(attemptDeadline(at("09:30"), { endsAt: null, timeLimitMinutes: 40 })).toEqual(at("10:10"));
    expect(attemptDeadline(at("09:30"), { endsAt: null, timeLimitMinutes: null })).toBeNull();
    expect(isPastDeadline(at("10:00"), at("10:00"))).toBe(true);
    expect(isPastDeadline(null, at("23:00"))).toBe(false);
  });

  it("window state", () => {
    const w = { startsAt: at("09:00"), endsAt: at("10:00") };
    expect(windowState(w, at("08:59"))).toBe("NOT_YET");
    expect(windowState(w, at("09:00"))).toBe("OPEN");
    expect(windowState(w, at("10:00"))).toBe("OVER");
    expect(windowState({ startsAt: null, endsAt: null }, at("10:00"))).toBe("OPEN");
  });
});

describe("anti-cheat (§4.4, acceptance 7)", () => {
  const t0 = utc(9).getTime();
  const feed = (events: [SeenEvent["type"], number][]) => {
    const seen: SeenEvent[] = [];
    for (const [type, ms] of events) {
      const e = { type, serverTs: new Date(t0 + ms) };
      seen.push({ ...e, counted: countsAsViolation(seen, e) });
    }
    return seen;
  };

  it("the same visibility event 3 times within 2 s counts once", () => {
    const seen = feed([
      ["VISIBILITY_HIDDEN", 0],
      ["VISIBILITY_HIDDEN", 500],
      ["VISIBILITY_HIDDEN", 1900],
    ]);
    expect(seen.filter((e) => e.counted)).toHaveLength(1);
  });

  it("blur next to a hidden page is one violation; visible/focus never count", () => {
    const seen = feed([
      ["BLUR", 0],
      ["VISIBILITY_HIDDEN", 30],
      ["VISIBILITY_VISIBLE", 5000],
      ["FOCUS", 5010],
      ["VISIBILITY_HIDDEN", 9000],
      ["BLUR", 20_000],
    ]);
    expect(seen.map((e) => e.counted)).toEqual([true, false, false, false, true, true]);
  });

  it("threshold 3 ends the attempt on the third counted violation; 0 is off", () => {
    expect(violationLimitReached(2, 3)).toBe(false);
    expect(violationLimitReached(3, 3)).toBe(true);
    expect(violationLimitReached(99, 0)).toBe(false);
  });
});

describe("result visibility (S4, acceptance 18)", () => {
  const now = utc(12);
  const before = utc(11);
  const after = utc(13);
  const base = { showResultToStudent: "IMMEDIATE" as const, testClosed: false, endsAt: before, overrideEnds: [], now };

  it("per-question results only after the common window and every retake window", () => {
    expect(resultVisibility(base)).toEqual({ score: true, perQuestion: true });
    expect(resultVisibility({ ...base, endsAt: after })).toEqual({ score: true, perQuestion: false });
    expect(resultVisibility({ ...base, overrideEnds: [after] })).toEqual({ score: true, perQuestion: false });
    expect(resultVisibility({ ...base, endsAt: null })).toEqual({ score: true, perQuestion: false });
    expect(resultVisibility({ ...base, endsAt: null, testClosed: true })).toEqual({ score: true, perQuestion: true });
  });

  it("AFTER_CLOSE hides the score until the window closes; NEVER hides everything", () => {
    expect(resultVisibility({ ...base, showResultToStudent: "AFTER_CLOSE", endsAt: after }).score).toBe(false);
    expect(resultVisibility({ ...base, showResultToStudent: "AFTER_CLOSE" }).score).toBe(true);
    expect(resultVisibility({ ...base, showResultToStudent: "NEVER" })).toEqual({ score: false, perQuestion: false });
  });
});

describe("statistics (§8)", () => {
  it("mean, median, extremes and a histogram", () => {
    const s = summarize([40, 100, 85, 70]);
    expect([s.count, n(s.mean), n(s.median), n(s.min), n(s.max)]).toEqual([4, 73.75, 77.5, 40, 100]);
    expect(s.histogram[4]).toBe(1);
    expect(s.histogram[9]).toBe(1); // 100 in the last bucket
    expect(summarize([]).mean).toBeNull();
  });

  it("topic mastery", () => {
    const m = topicMastery([
      { topicId: "loops", points: 2, awarded: 2 },
      { topicId: "loops", points: 2, awarded: 0 },
      { topicId: null, points: 1, awarded: 1 },
    ]);
    expect(n(m.get("loops")!.percent)).toBe(50);
    expect(n(m.get(null)!.percent)).toBe(100);
  });
});

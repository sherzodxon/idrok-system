// lesson-plan.md §8 acceptance 6 and 7 (pure level), §4.4 period rule.
import { describe, expect, it } from "vitest";
import { placeTopics, remainingHours, type PlaceItem, type PlaceSession } from "./curriculum";

const lessons = (n: number, periodId = "q1", from = 1): PlaceSession[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${from + i}`, periodId }));
const item = (n: number, hours = 1, periodId: string | null = null): PlaceItem => ({
  id: `i${n}`,
  topicId: `t${n}`,
  hours,
  periodId,
});

describe("placeTopics", () => {
  it("acceptance 6: 18 hours of topics (one of 2 hours) on 17 lessons → the last topic does not fit", () => {
    const items = Array.from({ length: 17 }, (_, i) => item(i + 1, i === 4 ? 2 : 1));
    const p = placeTopics(items, lessons(17));
    expect(p.bySession.size).toBe(17);
    expect(p.bySession.get("s5")).toBe("i5");
    expect(p.bySession.get("s6")).toBe("i5");
    expect(p.bySession.get("s17")).toBe("i16");
    expect(p.warnings).toEqual([{ kind: "NOT_PLACED", itemId: "i17", hours: 1 }]);
    expect(p.freeSessions).toBe(0);
  });

  it("acceptance 6, literally: 18 topics (one of 2 hours) on 17 lessons → the topics past the end are reported", () => {
    const items = Array.from({ length: 18 }, (_, i) => item(i + 1, i === 4 ? 2 : 1));
    expect(placeTopics(items, lessons(17)).warnings).toEqual([
      { kind: "NOT_PLACED", itemId: "i17", hours: 1 },
      { kind: "NOT_PLACED", itemId: "i18", hours: 1 },
    ]);
  });

  it("acceptance 7: a cancelled lesson pushes the next topics by one", () => {
    const items = Array.from({ length: 5 }, (_, i) => item(i + 1));
    const before = placeTopics(items, lessons(6));
    const after = placeTopics(
      items,
      lessons(6).filter((s) => s.id !== "s3"),
    );
    expect(before.bySession.get("s3")).toBe("i3");
    expect(after.bySession.get("s4")).toBe("i3");
    expect(after.bySession.get("s6")).toBe("i5");
    expect(after.bySession.get("s1")).toBe("i1");
  });

  it("a topic bound to a period stays inside it; spare lessons are reported", () => {
    const sessions = [...lessons(3, "q1"), ...lessons(3, "q2", 4)];
    const p = placeTopics([item(1, 1), item(2, 4, "q2")], sessions);
    // i2 skips the rest of q1 and gets the 3 lessons of q2; one hour does not fit.
    expect([...p.bySession.entries()]).toEqual([
      ["s1", "i1"],
      ["s4", "i2"],
      ["s5", "i2"],
      ["s6", "i2"],
    ]);
    expect(p.warnings).toEqual([{ kind: "PERIOD_OVERFLOW", itemId: "i2", hours: 1 }]);
    expect(p.freeSessions).toBe(2);
  });

  it("a topic of a period without lessons is not placed", () => {
    expect(placeTopics([item(1, 1, "q4")], lessons(2)).warnings).toEqual([
      { kind: "NOT_PLACED", itemId: "i1", hours: 1 },
    ]);
  });
});

describe("remainingHours", () => {
  it("fixed lessons take hours off the first items with their topic", () => {
    const items = [item(1, 2), item(2, 1), { ...item(3, 2), topicId: "t1" }];
    const left = remainingHours(items, new Map([["t1", 3]]));
    expect([...left.entries()]).toEqual([
      ["i1", 0],
      ["i2", 1],
      ["i3", 1],
    ]);
    const p = placeTopics(items, lessons(3), left);
    expect([...p.bySession.values()]).toEqual(["i2", "i3"]);
  });
});

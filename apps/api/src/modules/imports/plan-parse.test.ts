// lesson-plan.md §8 acceptance 8 and 9 (parsing level).
import { describe, expect, it } from "vitest";
import { mergePlanRows, parsePlanRows, type PlanRowData } from "./plan-parse";

const ctx = (mode: "ROWS" | "TOPICS") => ({ mode, periodIdByName: new Map([["1-chorak", "q1"]]) });
const rows = (list: Record<string, string>[]) => list.map((values, i) => ({ rowNumber: i + 3, values }));
const items = (mode: "ROWS" | "TOPICS", list: Record<string, string>[]) =>
  mergePlanRows(
    parsePlanRows(rows(list), ctx(mode))
      .filter((r) => r.status === "OK" || r.status === "WARNING")
      .map((r) => r.data as PlanRowData),
  );

describe("curriculum plan import", () => {
  it("acceptance 8: ROWS and TOPICS give the same items (dates aside)", () => {
    const byRows = items("ROWS", [
      { lessonNo: "1", periodName: "1-chorak", lessonDate: "2026-09-07", topic: "Kasrlar", hours: "1" },
      { lessonNo: "2", periodName: "1-chorak", lessonDate: "2026-09-10", topic: "kasrlar ", hours: "1" },
      {
        lessonNo: "3",
        periodName: "1-chorak",
        lessonDate: "2026-09-14",
        topic: "Nazorat ishi",
        hours: "1",
        lessonType: "Nazorat ishi",
      },
      { lessonNo: "4", periodName: "1-chorak", lessonDate: "2026-09-17", hours: "1" },
    ]);
    const byTopics = items("TOPICS", [
      { periodName: "1-chorak", topic: "Kasrlar", hours: "2" },
      { periodName: "1-chorak", topic: "Nazorat ishi", hours: "1", lessonType: "CONTROL_WORK" },
    ]);
    expect(byRows).toEqual(byTopics);
    expect(byTopics.map((i) => [i.topicTitle, i.hours, i.lessonType, i.periodId])).toEqual([
      ["Kasrlar", 2, "NEW", "q1"],
      ["Nazorat ishi", 1, "CONTROL_WORK", "q1"],
    ]);
  });

  it("acceptance 9: a row with content but no topic is an error; the other rows still preview", () => {
    const preview = parsePlanRows(
      rows([
        { topic: "Kirish", hours: "1" },
        { topic: "", hours: "1", homework: "1-mashq" },
        { topic: "Yakun", hours: "1" },
      ]),
      ctx("ROWS"),
    );
    expect(preview.map((r) => r.status)).toEqual(["OK", "ERROR", "OK"]);
    expect(preview[1]!.messages).toEqual([{ code: "REQUIRED", field: "topic" }]);
  });

  it("validates hours, lesson type, length; unknown periods only warn", () => {
    const preview = parsePlanRows(
      rows([
        { topic: "A", hours: "0" },
        { topic: "B", hours: "x" },
        { topic: "C", hours: "1", lessonType: "Ekskursiya" },
        { topic: "D".repeat(301), hours: "1" },
        { topic: "E", hours: "1", periodName: "5-chorak" },
        { topic: "F", hours: "" },
      ]),
      ctx("TOPICS"),
    );
    expect(preview.map((r) => r.messages.map((m) => m.code))).toEqual([
      ["INVALID_HOURS"],
      ["INVALID_HOURS"],
      ["INVALID_LESSON_TYPE"],
      ["TOO_LONG"],
      ["UNKNOWN_PERIOD"],
      ["REQUIRED"],
    ]);
    expect(preview[4]!.status).toBe("WARNING");
  });

  it("ru lesson type names are understood; TOPICS mode does not skip rows without a topic", () => {
    const [row] = parsePlanRows(rows([{ topic: "A", hours: "1", lessonType: "Повторение" }]), ctx("TOPICS"));
    expect((row!.data as PlanRowData).lessonType).toBe("REVIEW");
    const [empty] = parsePlanRows(rows([{ periodName: "1-chorak", hours: "1" }]), ctx("TOPICS"));
    expect(empty!.status).toBe("ERROR");
  });
});

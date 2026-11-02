// tests.md §3 Excel import; acceptance 16 (duplicates marked in the preview; a wrong "correct answer" is an error).
import { describe, expect, it } from "vitest";
import { contentHash } from "../../domain/tests";
import { parseQuestionRows } from "./question-import";

const row = (rowNumber: number, values: Record<string, string>) => ({ rowNumber, values });
const ctx = (known: string[] = []) => ({
  topicIdByTitle: new Map([["sikllar", "topic-loops"]]),
  knownHashes: new Set(known),
});

describe("question import", () => {
  it("SINGLE, MULTIPLE and SHORT_TEXT rows with topic, points and difficulty", () => {
    const [single, multiple, short] = parseQuestionRows(
      [
        row(3, { question: "2+2?", optionA: "3", optionB: "4", correct: "B", questionTopic: "Sikllar" }),
        row(4, {
          question: "Juft sonlar?",
          questionType: "Bir nechta javob",
          optionA: "2",
          optionB: "3",
          optionC: "4",
          correct: "A, C",
          points: "2",
          difficulty: "Qiyin",
          questionTopic: "sikllar",
        }),
        row(5, {
          question: "Poytaxt?",
          questionType: "Краткий ответ",
          correct: "Toshkent; Tashkent",
          questionTopic: "Sikllar",
        }),
      ],
      ctx(),
    );
    expect(single).toMatchObject({ status: "OK", data: { type: "SINGLE", topicId: "topic-loops", points: "1" } });
    expect(single!.data!.options.map((o) => o.isCorrect)).toEqual([false, true]);
    expect(multiple).toMatchObject({ status: "OK", data: { type: "MULTIPLE", difficulty: "HARD", points: "2" } });
    expect(multiple!.data!.options.filter((o) => o.isCorrect).map((o) => o.id)).toEqual(["a", "c"]);
    expect(short).toMatchObject({
      status: "OK",
      data: { type: "SHORT_TEXT", acceptedAnswers: ["Toshkent", "Tashkent"] },
    });
  });

  it("acceptance 16: a letter beyond the options is an error; a known question is skipped as a duplicate", () => {
    const known = contentHash({
      type: "SINGLE",
      text: "2+2?",
      options: [{ text: "3" }, { text: "4" }],
    });
    const rows = parseQuestionRows(
      [
        row(3, { question: "Savol?", optionA: "1", optionB: "2", optionC: "3", optionD: "4", correct: "G" }),
        row(4, { question: "2 + 2?", optionA: "4", optionB: "3", correct: "A" }),
        row(5, { question: "Yangi?", optionA: "x", optionB: "y", correct: "A" }),
        row(6, { question: "yangi?", optionA: "X", optionB: "Y", correct: "A" }),
      ],
      ctx([known]),
    );
    expect(rows[0]).toMatchObject({
      status: "ERROR",
      messages: [{ code: "INVALID_CORRECT_ANSWER" }, { code: "NO_TOPIC" }],
    });
    // "2 + 2?" normalises differently from "2+2?" (spaces inside are kept) — a new question; the next one is in the bank.
    expect(rows[1]!.status).toBe("WARNING");
    expect(rows[2]!.status).toBe("WARNING");
    expect(rows[3]).toMatchObject({
      status: "SKIPPED",
      messages: [{ code: "DUPLICATE_IN_FILE" }, { code: "NO_TOPIC" }],
    });
    const again = parseQuestionRows(
      [row(3, { question: "2+2?", optionA: "4", optionB: "3", correct: "B" })],
      ctx([known]),
    );
    expect(again[0]).toMatchObject({
      status: "SKIPPED",
      messages: [{ code: "DUPLICATE_QUESTION" }, { code: "NO_TOPIC" }],
    });
  });

  it("other errors: two answers on SINGLE, a gap in the options, bad points, unknown type and topic", () => {
    const rows = parseQuestionRows(
      [
        row(3, { question: "?", optionA: "1", optionB: "2", correct: "A,B" }),
        row(4, { question: "?", optionA: "1", optionC: "2", correct: "A" }),
        row(5, { question: "?", optionA: "1", optionB: "2", correct: "A", points: "-1" }),
        row(6, { question: "?", questionType: "Moslashtirish", correct: "A" }),
        row(7, { question: "Q?", optionA: "1", optionB: "2", correct: "A", questionTopic: "Massivlar" }),
      ],
      ctx(),
    );
    expect(rows.slice(0, 4).map((r) => r.status)).toEqual(["ERROR", "ERROR", "ERROR", "ERROR"]);
    expect(rows[0]!.messages[0]!.code).toBe("SINGLE_NEEDS_ONE_CORRECT");
    expect(rows[1]!.messages[0]!.code).toBe("OPTION_GAP");
    expect(rows[2]!.messages[0]!.code).toBe("INVALID_POINTS");
    expect(rows[3]!.messages[0]!.code).toBe("INVALID_QUESTION_TYPE");
    expect(rows[4]).toMatchObject({
      status: "WARNING",
      data: { topicId: null },
      messages: [{ code: "TOPIC_NOT_FOUND" }],
    });
  });
});

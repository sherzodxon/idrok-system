// Question bank Excel import (tests.md §3): Savol | Turi | A–F | To'g'ri javob | Ball | Mavzu | Qiyinlik | Izoh.
// Pure: the processor passes the topics of the subject and grade and the content hashes already in the bank.
// A duplicate (of the bank or of an earlier row) is SKIPPED with a message; an unknown topic is a warning (the
// question is added without a topic — topics are never created by this import).
import {
  importLabelsRu,
  importLabelsUz,
  normalizeText,
  type QuestionDifficultyCode,
  type QuestionTypeCode,
} from "@idrok/shared";
import { contentHash, questionProblems } from "../../domain/tests";
import type { SheetRow } from "../imports/excel";
import type { Message, PreviewRow } from "../imports/parse";

export interface QuestionRowData {
  type: QuestionTypeCode;
  text: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  acceptedAnswers: string[] | null;
  points: string;
  topicId: string | null;
  difficulty: QuestionDifficultyCode;
  explanation: string | null;
  contentHash: string;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
const MAX_TEXT = 4000;
const MAX_OPTION = 500;

const byText = <T extends string>(pick: (l: typeof importLabelsUz) => Record<T, string>) =>
  new Map<string, T>(
    [importLabelsUz, importLabelsRu].flatMap((l) =>
      (Object.entries(pick(l)) as [T, string][]).flatMap(([code, label]) => [
        [normalizeText(label), code],
        [normalizeText(code), code],
      ]),
    ),
  );
const typeByText = byText((l) => l.questionTypes);
const difficultyByText = byText((l) => l.difficulties);

export function parseQuestionRows(
  rows: SheetRow[],
  ctx: { topicIdByTitle: Map<string, string>; knownHashes: Set<string> },
): PreviewRow<QuestionRowData | null>[] {
  const seen = new Set(ctx.knownHashes);
  const inFile = new Set<string>();
  return rows.map(({ rowNumber, values: v }) => {
    const errors: Message[] = [];
    const warnings: Message[] = [];
    const text = (v.question ?? "").trim();
    if (!text) errors.push({ code: "REQUIRED", field: "question" });
    else if (text.length > MAX_TEXT) errors.push({ code: "TOO_LONG", field: "question", params: { max: MAX_TEXT } });

    const typeText = (v.questionType ?? "").trim();
    const type = typeText ? typeByText.get(normalizeText(typeText)) : "SINGLE";
    if (!type) errors.push({ code: "INVALID_QUESTION_TYPE", field: "questionType", params: { value: typeText } });

    const options = LETTERS.flatMap((letter) => {
      const t = (v[`option${letter}`] ?? "").trim();
      return t ? [{ id: letter.toLowerCase(), text: t, isCorrect: false }] : [];
    });
    for (const o of options)
      if (o.text.length > MAX_OPTION)
        errors.push({ code: "TOO_LONG", field: `option${o.id.toUpperCase()}`, params: { max: MAX_OPTION } });
    // A gap (A, B, D) would shift letters: refuse rather than guess.
    const lastFilled = LETTERS.reduce((last, l, i) => ((v[`option${l}`] ?? "").trim() ? i : last), -1);
    if (lastFilled + 1 !== options.length) errors.push({ code: "OPTION_GAP", field: "optionA" });

    const correctText = (v.correct ?? "").trim();
    let acceptedAnswers: string[] | null = null;
    if (!correctText) errors.push({ code: "REQUIRED", field: "correct" });
    else if (type === "SINGLE" || type === "MULTIPLE") {
      if (options.length < 2) errors.push({ code: "TOO_FEW_OPTIONS", field: "optionA" });
      const letters = correctText
        .toUpperCase()
        .split(/[\s,;]+/)
        .filter(Boolean);
      const unknown = letters.filter((l) => !options.some((o) => o.id === l.toLowerCase()));
      if (unknown.length) {
        errors.push({ code: "INVALID_CORRECT_ANSWER", field: "correct", params: { value: correctText } });
      } else {
        for (const o of options) o.isCorrect = letters.includes(o.id.toUpperCase());
        if (type === "SINGLE" && letters.length !== 1)
          errors.push({ code: "SINGLE_NEEDS_ONE_CORRECT", field: "correct", params: { value: correctText } });
      }
    } else if (type === "SHORT_TEXT") {
      acceptedAnswers = correctText
        .split(";")
        .map((a) => a.trim())
        .filter(Boolean);
      if (options.length) warnings.push({ code: "OPTIONS_IGNORED", field: "optionA" });
    }

    const pointsText = (v.points ?? "").trim().replace(",", ".");
    const points = pointsText || "1";
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(points) || Number(points) <= 0)
      errors.push({ code: "INVALID_POINTS", field: "points", params: { value: pointsText } });

    const diffText = (v.difficulty ?? "").trim();
    const difficulty = diffText ? difficultyByText.get(normalizeText(diffText)) : "MEDIUM";
    if (!difficulty) errors.push({ code: "INVALID_DIFFICULTY", field: "difficulty", params: { value: diffText } });

    const topicText = (v.questionTopic ?? "").trim();
    const topicId = topicText ? (ctx.topicIdByTitle.get(normalizeText(topicText)) ?? null) : null;
    if (topicText && !topicId)
      warnings.push({ code: "TOPIC_NOT_FOUND", field: "questionTopic", params: { value: topicText } });
    if (!topicText) warnings.push({ code: "NO_TOPIC", field: "questionTopic" });

    if (!errors.length && type) {
      for (const p of questionProblems({ type, text, options, acceptedAnswers }))
        errors.push({ code: p, field: p === "NO_ACCEPTED_ANSWERS" ? "correct" : "question" });
    }
    if (errors.length || !type || !difficulty)
      return { rowNumber, status: "ERROR", data: null, messages: [...errors, ...warnings] };

    const hash = contentHash({ type, text, options, acceptedAnswers });
    const data: QuestionRowData = {
      type,
      text,
      options: type === "SHORT_TEXT" ? [] : options,
      acceptedAnswers,
      points,
      topicId,
      difficulty,
      explanation: (v.explanation ?? "").trim().slice(0, 2000) || null,
      contentHash: hash,
    };
    if (seen.has(hash)) {
      const code = inFile.has(hash) ? "DUPLICATE_IN_FILE" : "DUPLICATE_QUESTION";
      return { rowNumber, status: "SKIPPED", data, messages: [{ code, field: "question" }, ...warnings] };
    }
    seen.add(hash);
    inFile.add(hash);
    return { rowNumber, status: warnings.length ? "WARNING" : "OK", data, messages: warnings };
  });
}

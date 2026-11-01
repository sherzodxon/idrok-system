// Curriculum plan import (lesson-plan.md §4.3): rows → items. Pure: the processor passes the year's periods.
// ROWS mode: the template has one row per lesson; rows without a topic are spare lessons and are skipped.
// TOPICS mode: only topics and hours. Both end in the same items: consecutive rows with the same topic are one item
// (acceptance 8), and any row with content but no topic is an error (acceptance 9).
import { importLabelsRu, importLabelsUz, normalizeText, type LessonTypeCode } from "@idrok/shared";
import type { SheetRow } from "./excel";
import type { Message, PreviewRow } from "./parse";

export type PlanImportMode = "ROWS" | "TOPICS";

export interface PlanRowData {
  topicTitle: string;
  hours: number;
  lessonType: LessonTypeCode;
  periodId: string | null;
  objectives: string | null;
  homework: string | null;
  resources: string | null;
  notes: string | null;
}

const MAX_TOPIC = 300;
const MAX_TEXT = 2000;
const LESSON_TYPES = Object.keys(importLabelsUz.lessonTypes) as LessonTypeCode[];

/** Codes and their translated names (uz, ru) → code. */
const lessonTypeByText = new Map<string, LessonTypeCode>(
  LESSON_TYPES.flatMap((code) => [
    [normalizeText(code), code],
    [normalizeText(importLabelsUz.lessonTypes[code]), code],
    [normalizeText(importLabelsRu.lessonTypes[code]), code],
  ]),
);

export function parsePlanRows(
  rows: SheetRow[],
  ctx: { mode: PlanImportMode; periodIdByName: Map<string, string> },
): PreviewRow<PlanRowData | null>[] {
  return rows.map(({ rowNumber, values: v }) => {
    const errors: Message[] = [];
    const warnings: Message[] = [];
    const topic = (v.topic ?? "").trim();
    const extras = ["lessonType", "objectives", "homework", "resources", "notes"].some((k) => (v[k] ?? "").trim());
    // A template lesson row left empty: only the prefilled №, period, date and hours.
    if (!topic && ctx.mode === "ROWS" && !extras) return { rowNumber, status: "SKIPPED", data: null, messages: [] };
    if (!topic) errors.push({ code: "REQUIRED", field: "topic" });
    else if (topic.length > MAX_TOPIC) errors.push({ code: "TOO_LONG", field: "topic", params: { max: MAX_TOPIC } });

    const hoursText = (v.hours ?? "").trim();
    const hours = Number(hoursText);
    if (!hoursText) errors.push({ code: "REQUIRED", field: "hours" });
    else if (!Number.isInteger(hours) || hours < 1 || hours > 100)
      errors.push({ code: "INVALID_HOURS", field: "hours", params: { value: hoursText } });

    const typeText = (v.lessonType ?? "").trim();
    const lessonType = typeText ? lessonTypeByText.get(normalizeText(typeText)) : "NEW";
    if (!lessonType) errors.push({ code: "INVALID_LESSON_TYPE", field: "lessonType", params: { value: typeText } });

    const periodText = (v.periodName ?? "").trim();
    const periodId = periodText ? (ctx.periodIdByName.get(normalizeText(periodText)) ?? null) : null;
    if (periodText && !periodId)
      warnings.push({ code: "UNKNOWN_PERIOD", field: "periodName", params: { value: periodText } });

    const text = (key: string) => {
      const value = (v[key] ?? "").trim();
      if (value.length > MAX_TEXT) errors.push({ code: "TOO_LONG", field: key, params: { max: MAX_TEXT } });
      return value || null;
    };
    const data: PlanRowData = {
      topicTitle: topic,
      hours: Number.isInteger(hours) ? hours : 0,
      lessonType: lessonType ?? "NEW",
      periodId,
      objectives: text("objectives"),
      homework: text("homework"),
      resources: text("resources"),
      notes: text("notes"),
    };
    const messages = [...errors, ...warnings];
    return { rowNumber, status: errors.length ? "ERROR" : warnings.length ? "WARNING" : "OK", data, messages };
  });
}

/** Plan items from the importable rows: consecutive rows with the same topic (and period) become one item. */
export function mergePlanRows(rows: PlanRowData[]): PlanRowData[] {
  const items: PlanRowData[] = [];
  for (const row of rows) {
    const last = items.at(-1);
    if (last && normalizeText(last.topicTitle) === normalizeText(row.topicTitle) && last.periodId === row.periodId) {
      last.hours += row.hours;
      last.homework ??= row.homework;
      last.objectives ??= row.objectives;
      last.resources ??= row.resources;
      last.notes ??= row.notes;
    } else items.push({ ...row });
  }
  return items;
}

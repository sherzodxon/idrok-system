// Question bank template and export (tests.md §3): the same columns and hidden key row as every import, so an export
// can be edited and imported again. MATCHING questions are not representable in the sheet and are left out.
import ExcelJS from "exceljs";
import { IMPORT_COLUMNS, importLabelsRu, importLabelsUz } from "@idrok/shared";
import type { TemplateLocale } from "../imports/excel";

const LABELS = { uz: importLabelsUz, ru: importLabelsRu };
const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

export interface ExportQuestion {
  type: "SINGLE" | "MULTIPLE" | "SHORT_TEXT" | "MATCHING";
  text: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  acceptedAnswers: string[] | null;
  points: string;
  topicTitle: string | null;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  explanation: string | null;
}

export async function buildQuestionSheet(locale: TemplateLocale, questions: ExportQuestion[]): Promise<Buffer> {
  const labels = LABELS[locale];
  const columns = IMPORT_COLUMNS.QUESTIONS;
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(labels.sheetData);
  sheet.getRow(1).values = columns.map((c) => c.key);
  sheet.getRow(1).hidden = true;
  const header = sheet.getRow(2);
  header.values = columns.map((c) => labels.columns[c.key as keyof typeof labels.columns] ?? c.key);
  header.font = { bold: true };
  columns.forEach((c, i) => {
    sheet.getColumn(i + 1).width = c.width ?? 14;
    sheet.getColumn(i + 1).numFmt = "@";
  });
  sheet.views = [{ state: "frozen", ySplit: 2 }];
  const col = (key: string) => columns.findIndex((c) => c.key === key) + 1;
  let r = 3;
  for (const q of questions) {
    if (q.type === "MATCHING" || q.options.length > LETTERS.length) continue;
    const row = sheet.getRow(r++);
    row.getCell(col("question")).value = q.text;
    row.getCell(col("questionType")).value = labels.questionTypes[q.type];
    q.options.forEach((o, i) => (row.getCell(col(`option${LETTERS[i]}`)).value = o.text));
    row.getCell(col("correct")).value =
      q.type === "SHORT_TEXT"
        ? (q.acceptedAnswers ?? []).join("; ")
        : q.options.flatMap((o, i) => (o.isCorrect ? [LETTERS[i]] : [])).join(",");
    row.getCell(col("points")).value = q.points;
    row.getCell(col("questionTopic")).value = q.topicTitle ?? "";
    row.getCell(col("difficulty")).value = labels.difficulties[q.difficulty];
    row.getCell(col("explanation")).value = q.explanation ?? "";
  }
  const help = wb.addWorksheet(labels.sheetHelp);
  labels.questionHelp.forEach((line, i) => (help.getCell(i + 1, 1).value = line));
  help.getColumn(1).width = 120;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

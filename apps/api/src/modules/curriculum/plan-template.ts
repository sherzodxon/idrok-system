// Curriculum plan template (lesson-plan.md §4.2): the same hidden key row as every import, headers in the user's
// language, a lesson-type list with translated names, an instruction sheet. ROWS mode has one row per lesson of the
// chosen group (№, period, date for reference); TOPICS mode starts empty.
import ExcelJS from "exceljs";
import { IMPORT_COLUMNS, importLabelsRu, importLabelsUz } from "@idrok/shared";
import { FIRST_DATA_ROW, type TemplateLocale } from "../imports/excel";

const LABELS = { uz: importLabelsUz, ru: importLabelsRu };
const EMPTY_ROWS = 60;

export interface TemplateLesson {
  date: string;
  periodName: string;
}

export async function buildPlanTemplate(locale: TemplateLocale, lessons: TemplateLesson[] | null): Promise<Buffer> {
  const labels = LABELS[locale];
  const columns = IMPORT_COLUMNS.CURRICULUM_PLAN;
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
  (lessons ?? []).forEach((l, i) => {
    const row = sheet.getRow(FIRST_DATA_ROW + i);
    row.getCell(col("lessonNo")).value = String(i + 1);
    row.getCell(col("periodName")).value = l.periodName;
    row.getCell(col("lessonDate")).value = l.date;
    row.getCell(col("hours")).value = "1";
  });
  // Lesson type: a drop-down of the translated names (the import also accepts the codes).
  const typeList = `"${Object.values(labels.lessonTypes).join(",")}"`;
  const last = FIRST_DATA_ROW + Math.max(lessons?.length ?? 0, EMPTY_ROWS) - 1;
  for (let r = FIRST_DATA_ROW; r <= last; r++) {
    sheet.getRow(r).getCell(col("lessonType")).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [typeList],
    };
  }
  const help = wb.addWorksheet(labels.sheetHelp);
  labels.planHelp.forEach((line, i) => (help.getCell(i + 1, 1).value = line));
  help.getColumn(1).width = 120;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

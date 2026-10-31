import ExcelJS from "exceljs";
import { IMPORT_COLUMNS, importLabelsRu, importLabelsUz, type ImportKindCode } from "@idrok/shared";

export type TemplateLocale = "uz" | "ru";
const LABELS = { uz: importLabelsUz, ru: importLabelsRu };
const KEY_ROW = 1;
const HEADER_ROW = 2;
export const FIRST_DATA_ROW = 3;
export const MAX_IMPORT_ROWS = 2_000;

export class ImportFileError extends Error {
  constructor(readonly code: "IMPORT_FILE_UNREADABLE" | "IMPORT_TEMPLATE_MISMATCH" | "IMPORT_TOO_MANY_ROWS" | "IMPORT_EMPTY") {
    super(code);
  }
}

/** Template: hidden row 1 = column keys, row 2 = headers in the user's language, data from row 3; a help sheet. */
export async function buildTemplate(kind: ImportKindCode, locale: TemplateLocale): Promise<Buffer> {
  const labels = LABELS[locale];
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(labels.sheetData);
  const columns = IMPORT_COLUMNS[kind];
  sheet.getRow(KEY_ROW).values = columns.map((c) => c.key);
  sheet.getRow(KEY_ROW).hidden = true;
  const header = sheet.getRow(HEADER_ROW);
  header.values = columns.map((c) => labels.columns[c.key as keyof typeof labels.columns] ?? c.key);
  header.font = { bold: true };
  columns.forEach((c, i) => {
    sheet.getColumn(i + 1).width = c.width ?? 14;
    sheet.getColumn(i + 1).numFmt = "@"; // text: keeps leading zeros and phone numbers intact
  });
  sheet.views = [{ state: "frozen", ySplit: HEADER_ROW }];
  const help = wb.addWorksheet(labels.sheetHelp);
  labels.help.forEach((line, i) => (help.getCell(i + 1, 1).value = line));
  help.getColumn(1).width = 110;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10); // Excel dates are calendar dates (UTC midnight)
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    return "";
  }
  return String(value);
}

export interface SheetRow {
  rowNumber: number;
  values: Record<string, string>;
}

/** Reads the first sheet; the hidden key row decides which column is which. */
export async function readImportSheet(buffer: Buffer, kind: ImportKindCode): Promise<SheetRow[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError("IMPORT_FILE_UNREADABLE");
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new ImportFileError("IMPORT_FILE_UNREADABLE");
  const known = new Set(IMPORT_COLUMNS[kind].map((c) => c.key));
  const keyByCol = new Map<number, string>();
  sheet.getRow(KEY_ROW).eachCell((cell, col) => {
    const key = cellText(cell.value).trim();
    if (known.has(key)) keyByCol.set(col, key);
  });
  const required = IMPORT_COLUMNS[kind].filter((c) => c.required).map((c) => c.key);
  if (!required.every((k) => [...keyByCol.values()].includes(k))) throw new ImportFileError("IMPORT_TEMPLATE_MISMATCH");

  const rows: SheetRow[] = [];
  for (let r = FIRST_DATA_ROW; r <= sheet.rowCount; r++) {
    const values: Record<string, string> = {};
    let any = false;
    for (const [col, key] of keyByCol) {
      const text = cellText(sheet.getRow(r).getCell(col).value).trim();
      values[key] = text;
      if (text) any = true;
    }
    if (!any) continue;
    rows.push({ rowNumber: r, values });
    if (rows.length > MAX_IMPORT_ROWS) throw new ImportFileError("IMPORT_TOO_MANY_ROWS");
  }
  if (!rows.length) throw new ImportFileError("IMPORT_EMPTY");
  return rows;
}

/** Credentials sheet produced by a commit (downloadable once). */
export async function buildCredentialsFile(
  locale: TemplateLocale,
  rows: { kind: string; name: string; username: string; temporaryPassword: string }[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("logins");
  sheet.columns = [
    { header: locale === "ru" ? "Тип" : "Turi", key: "kind", width: 12 },
    { header: locale === "ru" ? "Ф.И.О." : "F.I.Sh.", key: "name", width: 32 },
    { header: locale === "ru" ? "Логин" : "Login", key: "username", width: 20 },
    { header: locale === "ru" ? "Временный пароль" : "Vaqtinchalik parol", key: "temporaryPassword", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };
  rows.forEach((r) => sheet.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

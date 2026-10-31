// Synthetic, clearly fake import files (Q-30: demo data only). Built from the real template, so the hidden key row
// is exactly what the API generates.
import ExcelJS from "exceljs";
import type { ImportKindCode } from "@idrok/shared";
import { buildTemplate, FIRST_DATA_ROW } from "../../src/modules/imports/excel";

export async function workbook(kind: ImportKindCode, rows: Record<string, string>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildTemplate(kind, "uz")) as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0]!;
  const keys = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
  rows.forEach((row, i) => {
    sheet.getRow(FIRST_DATA_ROW + i).values = keys.map((k) => row[k] ?? "");
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
export const CLASSES = ["4-A", "4-B", "5-A", "5-B", "6-A", "6-B", "7-A", "7-B", "8-A", "8-B", "9-A", "9-B"];

/** 300 students (25 per class) with two guardians each → 600 guardians with distinct phones. */
export function studentRows(count = 300): Record<string, string>[] {
  return Array.from({ length: count }, (_, i) => ({
    lastName: `Demo-familiya-${pad(i, 3)}`,
    firstName: `Demo-ism-${pad(i, 3)}`,
    dateOfBirth: `${2010 + (i % 8)}-${pad((i % 12) + 1, 2)}-${pad((i % 27) + 1, 2)}`,
    gender: i % 2 ? "E" : "A",
    className: CLASSES[Math.floor(i / 25) % CLASSES.length]!,
    guardian1LastName: `Demo-ona-${pad(i, 3)}`,
    guardian1FirstName: "Demo",
    guardian1Phone: `+99890${pad(1_000_000 + i * 2, 7)}`,
    guardian1Relation: "ona",
    guardian2LastName: `Demo-ota-${pad(i, 3)}`,
    guardian2FirstName: "Demo",
    guardian2Phone: `+99891${pad(1_000_000 + i * 2 + 1, 7)}`,
    guardian2Relation: "ota",
  }));
}

/** 40 teachers; teacher k teaches "Demo fan k%4" in two classes. */
export function teacherRows(subjects: string[]): Record<string, string>[] {
  return Array.from({ length: 40 }, (_, k) => ({
    employeeCode: `DEMO-T${pad(k, 3)}`,
    lastName: `Demo-ustoz-${pad(k, 2)}`,
    firstName: "Demo",
    roles: k < CLASSES.length ? "TEACHER, CLASS_TEACHER" : "TEACHER",
    homeroomClass: k < CLASSES.length ? CLASSES[k]! : "",
    assignments: `${subjects[k % subjects.length]}: ${CLASSES[k % CLASSES.length]}, ${CLASSES[(k + 1) % CLASSES.length]}`,
  }));
}

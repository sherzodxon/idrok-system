// Fills the real import template (downloaded from the API like an admin would) with synthetic demo rows (Q-30).
import type { APIRequestContext } from "@playwright/test";
import ExcelJS from "exceljs";
import { API_URL } from "./users";

const FIRST_DATA_ROW = 3;
const pad = (n: number, w: number) => String(n).padStart(w, "0");

export async function filledTemplate(
  request: APIRequestContext,
  kind: string,
  rows: Record<string, string>[],
): Promise<Buffer> {
  const res = await request.get(`${API_URL}/imports/templates/${kind}?locale=uz`);
  if (!res.ok()) throw new Error(`template ${kind}: ${res.status()}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await res.body()) as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0]!;
  const keys = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
  rows.forEach((row, i) => {
    sheet.getRow(FIRST_DATA_ROW + i).values = keys.map((k) => row[k] ?? "");
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const CLASSES = ["4-A", "4-B", "5-A", "5-B", "6-A", "6-B", "7-A", "7-B", "8-A", "8-B", "9-A", "9-B"];
export const SUBJECTS = ["Demo fan A", "Demo fan B", "Demo fan C", "Demo fan D"];

export const classRows = () =>
  CLASSES.map((c) => {
    const [level, section] = c.split("-");
    return { level: level!, section: section!, capacity: "30" };
  });

/** 300 students, 25 per class, two guardians each; phones do not overlap the seeded guardian. */
export const studentRows = () =>
  Array.from({ length: 300 }, (_, i) => ({
    lastName: `Demo-familiya-${pad(i, 3)}`,
    firstName: `Demo-ism-${pad(i, 3)}`,
    dateOfBirth: `${2010 + (i % 8)}-${pad((i % 12) + 1, 2)}-${pad((i % 27) + 1, 2)}`,
    gender: i % 2 ? "E" : "A",
    className: CLASSES[Math.floor(i / 25)]!,
    guardian1LastName: `Demo-ona-${pad(i, 3)}`,
    guardian1FirstName: "Demo",
    guardian1Phone: `+99890${pad(1_000_000 + i * 2, 7)}`,
    guardian1Relation: "ona",
    guardian2LastName: `Demo-ota-${pad(i, 3)}`,
    guardian2FirstName: "Demo",
    guardian2Phone: `+99891${pad(1_000_000 + i * 2 + 1, 7)}`,
    guardian2Relation: "ota",
  }));

/** 40 teachers; the first 12 are class teachers. */
export const teacherRows = () =>
  Array.from({ length: 40 }, (_, k) => ({
    employeeCode: `DEMO-T${pad(k, 3)}`,
    lastName: `Demo-ustoz-${pad(k, 2)}`,
    firstName: "Demo",
    roles: k < CLASSES.length ? "TEACHER, CLASS_TEACHER" : "TEACHER",
    homeroomClass: k < CLASSES.length ? CLASSES[k]! : "",
    assignments: `${SUBJECTS[k % SUBJECTS.length]}: ${CLASSES[k % CLASSES.length]}, ${CLASSES[(k + 1) % CLASSES.length]}`,
  }));

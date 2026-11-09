// Audit phase 6: the reports centre. Each Excel file agrees with what the pages show (attendance day, staff day,
// ledgers), respects the caller's scope and permissions, refuses long ranges and leaves an audit row.
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addSchoolDays, isoWeekday, schoolToday, type SchoolDate } from "@idrok/shared/time";
import { createTestApp } from "./support/app";
import { buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let key: string;

const DAY = (() => {
  let d = addSchoolDays(schoolToday(), -1);
  while (isoWeekday(d) === 7) d = addSchoolDays(d, -1);
  return d;
})();
const FROM = addSchoolDays(DAY, -6);
let serial = 9000;
const pass = (employeeNo: string, time: string, date: SchoolDate = DAY) =>
  request(t.app)
    .post(`/api/v1/attendance/hikvision-event/${key}`)
    .send({
      ipAddress: "192.168.1.64",
      dateTime: `${date}T${time}+05:00`,
      eventType: "AccessControllerEvent",
      AccessControllerEvent: { majorEventType: 5, subEventType: 75, employeeNoString: employeeNo, serialNo: serial++ },
    });

/** GET an .xlsx as the given user and read its sheets into arrays of rows (header first). */
async function xlsx(headers: Record<string, string>, path: string) {
  const res = await request(t.app)
    .get(`/api/v1${path}`)
    .set(headers)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  if (res.status !== 200) return { status: res.status, sheets: {} as Record<string, unknown[][]> };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as ArrayBuffer);
  const sheets: Record<string, unknown[][]> = {};
  wb.eachSheet((ws) => {
    const rows: unknown[][] = [];
    ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
    sheets[ws.name] = rows;
  });
  return { status: res.status, sheets, disposition: res.headers["content-disposition"] as string };
}

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  await s.a.put("/attendance/settings", { isEnabled: true });
  key = (
    await s.a.post("/devices", {
      name: "Kirish",
      serialNumber: null,
      ipAddress: null,
      port: 80,
      username: null,
      direction: "IN",
      location: null,
      useBridge: false,
      bridgeAgentId: null,
      isActive: true,
    })
  ).webhookKey;
  await pass(s.s7a.studentCode, "08:20:00");
  await pass(s.s7b.studentCode, "08:41:00");
  await s.a.patch(`/employees/${s.emp1.id}`, { employeeCode: "T001", phone: "+998 90 111 22 33" });
  await pass("E-T001", "07:55:00");
  await s.a.post("/coins/adjustments", {
    studentId: s.s7b.id,
    amount: 10,
    reason: "Olimpiada",
    idempotencyKey: randomUUID(),
  });
});
afterAll(() => t.close());

describe("attendance report", () => {
  it("has the same statuses as the day page, a summary per student and the rate", async () => {
    const file = await xlsx(s.adminAuthHeaders, `/reports/attendance.xlsx?from=${FROM}&to=${DAY}`);
    expect(file.status).toBe(200);
    expect(file.disposition).toContain(`attendance-${FROM}-${DAY}.xlsx`);
    const days = file.sheets["Kunlar"]!;
    expect(days[0]).toEqual([
      "Sana",
      "O'quvchi",
      "Sinf",
      "Holat",
      "Keldi",
      "Ketdi",
      "Kechikish (daq.)",
      "Erta ketish (daq.)",
    ]);
    const page = await s.a.get(`/attendance/day?date=${DAY}&pageSize=100`);
    const ofDay = days.filter((r) => r[0] === DAY);
    expect(ofDay).toHaveLength(page.total);
    const row7a = ofDay.find((r) => r[1] === "Oquvchi A Demo");
    expect(row7a).toEqual([DAY, "Oquvchi A Demo", "7-A", "Keldi", "08:20", "", "", ""]);
    // Days before the first terminal event are "no data", never absences.
    expect(days.filter((r) => r[0] !== DAY && r[0] !== "Sana").every((r) => r[3] === "Ma'lumot yo'q")).toBe(true);
    const summary = file.sheets["Jami"]!;
    const sum7a = summary.find((r) => r[0] === "Oquvchi A Demo")!;
    const noData = days.filter((r) => r[1] === "Oquvchi A Demo").length - 1;
    expect(sum7a.slice(3)).toEqual([1, 0, 0, 0, noData, 100]);
  });

  it("a class teacher gets their class only; a subject teacher none; the Russian file", async () => {
    const mine = await xlsx(s.teacher2, `/reports/attendance.xlsx?from=${DAY}&to=${DAY}`);
    expect(mine.sheets["Kunlar"]!.slice(1).map((r) => r[1])).toEqual(["Oquvchi B Demo"]);
    expect((await xlsx(s.teacher1, `/reports/attendance.xlsx?from=${DAY}&to=${DAY}`)).status).toBe(403);
    const ru = await xlsx(s.adminAuthHeaders, `/reports/attendance.xlsx?from=${DAY}&to=${DAY}&locale=ru`);
    expect(Object.keys(ru.sheets)).toEqual(["Итого", "Дни"]);
  });

  it("refuses a range over 92 days or backwards", async () => {
    const long = await s.a.raw("get", `/reports/attendance.xlsx?from=${addSchoolDays(DAY, -100)}&to=${DAY}`);
    expect(long.status).toBe(400);
    expect((await s.a.raw("get", `/reports/attendance.xlsx?from=${DAY}&to=${FROM}`)).status).toBe(400);
  });
});

describe("staff, scores and coins", () => {
  it("staff: first IN of the employee", async () => {
    const file = await xlsx(s.adminAuthHeaders, `/reports/staff-attendance.xlsx?from=${DAY}&to=${DAY}`);
    const row = file.sheets["Kunlar"]!.find((r) => r[1] === "Ustoz Bir Demo");
    expect(row?.slice(0, 5)).toEqual([DAY, "Ustoz Bir Demo", "", "Keldi", "07:55"]);
    expect((await xlsx(s.teacher1, `/reports/staff-attendance.xlsx?from=${DAY}&to=${DAY}`)).status).toBe(403);
  });

  it("coins: every ledger row; scores: headers even when empty", async () => {
    const coins = await xlsx(s.adminAuthHeaders, `/reports/coins.xlsx?from=${FROM}&to=${schoolToday()}`);
    expect(coins.sheets["Kunlar"]!.slice(1)).toEqual([
      [schoolToday(), "Oquvchi B Demo", s.s7b.studentCode, "Admin tuzatishi", "Admin", "", "", 10, 10, "Olimpiada"],
    ]);
    const scores = await xlsx(s.adminAuthHeaders, `/reports/scores.xlsx?from=${FROM}&to=${DAY}`);
    expect(scores.sheets["Kunlar"]).toHaveLength(1);
    expect((await xlsx(s.teacher1, `/reports/coins.xlsx?from=${FROM}&to=${DAY}`)).status).toBe(403);
  });

  it("every export is on record", async () => {
    const n = await t.deps.root.auditLog.count({
      where: { tenantId: t.defaultTenant.tenant.id, action: "report.export" },
    });
    expect(n).toBeGreaterThanOrEqual(5);
  });
});

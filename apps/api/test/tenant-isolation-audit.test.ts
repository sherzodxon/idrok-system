// Phase 7: the endpoints added during the audit phases (dashboards, criteria, consent, staff Face ID, staff day,
// reports, the user page) keep the tenant wall: another school's admin gets 404, empty lists or files without
// this school's rows — never data and never a change.
import ExcelJS from "exceljs";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schoolToday } from "@idrok/shared/time";
import { createTestApp } from "./support/app";
import { buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let a: Awaited<ReturnType<typeof buildSchool>>;
let b: Awaited<ReturnType<typeof buildSchool>>;
let criterionA: { id: string };
let userA: string;
const today = schoolToday();

function asB(method: "get" | "post" | "put" | "patch" | "delete", path: string, body?: unknown) {
  const agent = request(t.app);
  return agent[method](`/api/v1${path}`)
    .set(b.adminAuthHeaders)
    .send(body as object);
}

async function sheetRows(res: request.Response) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as ArrayBuffer);
  const rows: unknown[][] = [];
  wb.worksheets.at(-1)!.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
  return rows.slice(1);
}
const binary = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  a = await buildSchool(t, t.defaultTenant);
  b = await buildSchool(t, await t.createTenant());
  await a.a.put("/attendance/settings", { isEnabled: true });
  await b.a.put("/attendance/settings", { isEnabled: true });
  criterionA = await a.a.post("/score-criteria", { name: "Faollik", minPoints: 1, maxPoints: 4 });
  await a.a.post(`/face/students/${a.s7a.id}/consents`, { givenBy: "Vasiy A", givenOn: "2026-09-01" });
  await a.a.patch(`/employees/${a.emp1.id}`, { employeeCode: "A001", phone: "+998 90 111 22 33" });
  const photo = await sharp({ create: { width: 400, height: 500, channels: 3, background: "#a08070" } })
    .png()
    .toBuffer();
  await request(t.app)
    .put(`/api/v1/face/employees/${a.emp1.id}/photo`)
    .set(a.adminAuthHeaders)
    .attach("file", photo, { filename: "f.png", contentType: "image/png" })
    .expect(200);
  await a.a.post("/coins/adjustments", {
    studentId: a.s7a.id,
    amount: 5,
    reason: "A",
    idempotencyKey: crypto.randomUUID(),
  });
  userA = (await t.deps.root.employee.findUniqueOrThrow({ where: { id: a.emp1.id } })).userId!;
});
afterAll(() => t.close());

describe("tenant isolation of the audit-phase endpoints", () => {
  it("reads of another school's ids are 404", async () => {
    for (const path of [
      `/face/students/${a.s7a.id}`,
      `/face/students/${a.s7a.id}/consents`,
      `/face/employees/${a.emp1.id}`,
      `/face/employees/${a.emp1.id}/photo`,
      `/users/${userA}`,
    ]) {
      const res = await asB("get", path);
      expect(res.status, path).toBe(404);
    }
  });

  it("writes to another school's ids are 404 and change nothing", async () => {
    const writes = [
      ["patch", `/score-criteria/${criterionA.id}`, { name: "hijack", maxPoints: 99 }],
      ["post", "/score-limit-rules", { window: "DAY", scopeType: "CRITERION", scopeId: criterionA.id, maxPoints: 1 }],
      ["post", `/face/students/${a.s7a.id}/consents`, { givenBy: "B", givenOn: "2026-09-01" }],
      ["post", `/face/students/${a.s7a.id}/consents/revoke`, { reason: "hijack" }],
      ["delete", `/face/employees/${a.emp1.id}/photo`, undefined],
      ["post", `/face/employees/${a.emp1.id}/resync`, {}],
      ["put", `/users/${userA}/username`, { username: "hijack.user" }],
      ["post", `/users/${userA}/sessions/revoke`, {}],
    ] as const;
    for (const [method, path, body] of writes) {
      const res = await asB(method, path, body);
      expect(res.status, `${method} ${path} ${JSON.stringify(res.body)}`).toBe(404);
    }
    expect(await t.deps.root.scoreCriterion.findUniqueOrThrow({ where: { id: criterionA.id } })).toMatchObject({
      name: "Faollik",
    });
    expect(await t.deps.root.faceConsent.count({ where: { studentId: a.s7a.id, revokedAt: null } })).toBe(1);
    expect(await t.deps.root.faceProfile.count({ where: { employeeId: a.emp1.id, photoAssetId: { not: null } } })).toBe(
      1,
    );
  });

  it("lists, dashboards and the staff day show only the caller's school", async () => {
    const staffFaces = (await asB("get", "/face/employees?pageSize=100")).body.items as { employeeId: string }[];
    expect(staffFaces.some((e) => e.employeeId === a.emp1.id)).toBe(false);
    const criteria = (await asB("get", "/score-criteria")).body as { id: string }[];
    expect(criteria.some((c) => c.id === criterionA.id)).toBe(false);
    const staffDay = (await asB("get", `/attendance/staff/day?date=${today}&pageSize=100`)).body;
    expect(staffDay.items.some((r: { employeeId: string }) => r.employeeId === a.emp1.id)).toBe(false);
    const summary = (await asB("get", "/attendance/summary?days=1")).body;
    expect(summary.today.byClass.some((c: { classGroupId: string }) => c.classGroupId === a.c7a.id)).toBe(false);
  });

  it("reports carry no row of another school, even with its class id", async () => {
    const coins = await binary(asB("get", `/reports/coins.xlsx?from=${today}&to=${today}&classGroupId=${a.c7a.id}`));
    expect(coins.status).toBe(200);
    expect(await sheetRows(coins)).toEqual([]);
    const all = await binary(asB("get", `/reports/coins.xlsx?from=${today}&to=${today}`));
    expect((await sheetRows(all)).some((r) => r[2] === a.s7a.studentCode)).toBe(false);
    const att = await binary(asB("get", `/reports/attendance.xlsx?from=${today}&to=${today}&classGroupId=${a.c7a.id}`));
    expect(await sheetRows(att)).toEqual([]);
  });
});

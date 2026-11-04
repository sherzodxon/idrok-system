// M6 step 5: automatic coins for school attendance — rule validation, on time / lateness bands after the shift is over,
// once per student and day, nothing for manual marks or arrivals outside every band, the debt floor for penalties.
import request from "supertest";
import { runWithTenant } from "@idrok/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addSchoolDays, atSchoolTime, isoWeekday, schoolToday } from "@idrok/shared/time";
import { awardAttendanceCoins } from "../src/modules/attendance/attendance-coins";
import { attendanceCoins } from "../src/worker";
import { createTestApp } from "./support/app";
import { buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let key: string;
let reward: { id: string };
let penalty: { id: string };
const bands: Record<string, string> = {};

const DAY = (() => {
  let d = addSchoolDays(schoolToday(), -1);
  while (isoWeekday(d) === 7) d = addSchoolDays(d, -1);
  return d;
})();
let serial = 1;
const push = (code: string, time: string) =>
  request(t.app)
    .post(`/api/v1/attendance/hikvision-event/${key}`)
    .send({
      eventType: "AccessControllerEvent",
      dateTime: `${DAY}T${time}+05:00`,
      AccessControllerEvent: { majorEventType: 5, subEventType: 75, employeeNoString: code, serialNo: serial++ },
    })
    .expect(200);
const balance = async (id: string) => (await s.a.get(`/coins/students/${id}/summary`)).balance as number;
const award = (now: Date) =>
  runWithTenant({ tenantId: t.defaultTenant.tenant.id }, () => awardAttendanceCoins(t.deps.db, DAY, now));
const rule = (criterionId: string, latenessBandId: string | null, amount: number) =>
  s.a.raw("post", "/coins/auto-rules", { source: "ATTENDANCE", criterionId, config: { latenessBandId, amount } });

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
  for (const [name, fromMinute, toMinute] of [
    ["1-3", 1, 3],
    ["3-7", 3, 7],
  ] as const) {
    bands[name] = (await s.a.post("/attendance/lateness-bands", { name, fromMinute, toMinute })).id;
  }
  reward = await s.a.post("/coins/criteria", {
    name: "Vaqtida kelish",
    type: "REWARD",
    minAmount: 1,
    maxAmount: 5,
    isAutomatic: true,
  });
  penalty = await s.a.post("/coins/criteria", {
    name: "Kechikish",
    type: "PENALTY",
    minAmount: 1,
    maxAmount: 5,
    isAutomatic: true,
  });
});
afterAll(() => t.close());

describe("attendance coin rules", () => {
  it("on time rewards, a band takes; one active rule per outcome; the band must exist", async () => {
    expect((await rule(penalty.id, null, 2)).body.error.details.fields[0]).toMatchObject({ code: "direction" });
    expect((await rule(reward.id, bands["3-7"]!, 1)).status).toBe(400);
    expect((await rule(penalty.id, "0190f5a0-0000-7000-8000-000000000009", 1)).status).toBe(400);
    expect((await rule(reward.id, null, 2)).status).toBe(201);
    expect((await rule(penalty.id, bands["3-7"]!, 4)).status).toBe(201);
    expect((await rule(reward.id, null, 3)).body.error.details.reason).toBe("DUPLICATE");
    const rules = await s.a.get("/coins/auto-rules");
    expect(rules.filter((r: { source: string }) => r.source === "ATTENDANCE")).toHaveLength(2);
    // A band used by a rule is archived, not deleted.
    expect(await s.a.raw("delete", `/attendance/lateness-bands/${bands["3-7"]}`).then((r) => r.body)).toEqual({
      deleted: false,
    });
    // Restore an active 3-7 band for the rest of the tests.
    const again = await s.a.raw("post", "/attendance/lateness-bands", { name: "3-7", fromMinute: 3, toMinute: 7 });
    bands["3-7"] = again.body.id;
    const old = rules.find((r: { config: { latenessBandId?: string | null } }) => r.config.latenessBandId);
    await s.a.put(`/coins/auto-rules/${old.id}`, { ...old, isActive: false, id: undefined, criterionName: undefined });
    expect((await rule(penalty.id, bands["3-7"]!, 4)).status).toBe(201);
  });
});

describe("awarding", () => {
  it("waits for the end of the shift, then awards once", async () => {
    await s.a.put("/coins/settings", { ...(await s.a.get("/coins/settings")), allowNegativeBalance: true, maxDebt: 2 });
    await push(s.s7a.studentCode, "08:25:00"); // on time: +2
    await push(s.s7b.studentCode, "08:36:00"); // 6 min late, band 3-7: -4, capped by the floor (-2)
    await push(s.s4a.studentCode, "08:31:30"); // 1 min late, band 1-3: no rule
    expect(await award(atSchoolTime(DAY, 9 * 60))).toBe(0);
    expect(await award(atSchoolTime(DAY, 13 * 60 + 30))).toBe(2);
    expect(await balance(s.s7a.id)).toBe(2);
    expect(await balance(s.s7b.id)).toBe(-2);
    expect(await balance(s.s4a.id)).toBe(0);
    expect(await award(new Date())).toBe(0);
    const tx = await s.a.get(`/coins/students/${s.s7a.id}/transactions`);
    expect(tx.items[0]).toMatchObject({ source: "ATTENDANCE", criterionName: "Vaqtida kelish", amount: 2 });
  });

  it("a manual mark earns nothing; the worker job covers the last days", async () => {
    const other = await s.a.post("/students", {
      firstName: "Demo",
      lastName: "Oquvchi Yangi",
      enrollment: { classGroupId: s.c7a.id, validFrom: "2026-09-01" },
    });
    await push(other.studentCode, "08:20:00");
    await s.a.put(`/attendance/students/${other.id}/days/${DAY}`, { status: "PRESENT", reason: "Qo'lda tekshirildi" });
    await attendanceCoins(t.deps);
    expect(await balance(other.id)).toBe(0);
  });

  it("switched-off automatic coins award nothing", async () => {
    await s.a.put("/coins/settings", { ...(await s.a.get("/coins/settings")), autoCoinsEnabled: false });
    const late = await s.a.post("/students", {
      firstName: "Demo",
      lastName: "Oquvchi Kech",
      enrollment: { classGroupId: s.c7a.id, validFrom: "2026-09-01" },
    });
    await push(late.studentCode, "08:24:00");
    expect(await award(new Date())).toBe(0);
    expect(await balance(late.id)).toBe(0);
  });
});

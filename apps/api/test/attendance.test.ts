// M6 step 2: terminals, the Hikvision webhook (JSON and multipart, idempotent, under concurrent pushes), school
// attendance from events (lateness bands, early leave), the day journal with its scope, manual marks and settings.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addSchoolDays, isoWeekday, schoolToday, type SchoolDate } from "@idrok/shared/time";
import { maskUrlSecrets } from "../src/logger";
import { createTestApp } from "./support/app";
import { api, buildSchool, studentAuth } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let inKey: string;
let outKey: string;
let inDevice: { id: string };
let bands: { id: string; name: string }[];

/** The last Monday..Saturday before today: a past working day, so absence is final. */
const DAY = (() => {
  let d = addSchoolDays(schoolToday(), -1);
  while (isoWeekday(d) === 7) d = addSchoolDays(d, -1);
  return d;
})();
const at = (time: string, date: SchoolDate = DAY) => `${date}T${time}+05:00`;
let serial = 1000;
const event = (employeeNo: string, time: string, over: Record<string, unknown> = {}) => ({
  ipAddress: "192.168.1.64",
  dateTime: at(time),
  eventType: "AccessControllerEvent",
  AccessControllerEvent: {
    majorEventType: 5,
    subEventType: 75,
    employeeNoString: employeeNo,
    serialNo: serial++,
    ...over,
  },
});
const push = (key: string, body: unknown) =>
  request(t.app)
    .post(`/api/v1/attendance/hikvision-event/${key}`)
    .send(body as object);

const code = (st: { studentCode: string }) => st.studentCode;

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  const created = await s.a.post("/devices", {
    name: "Kirish",
    serialNumber: "DS-K1T341-001",
    ipAddress: "192.168.1.64",
    port: 80,
    username: "admin",
    password: "device-secret-1",
    direction: "IN",
    location: "Asosiy kirish",
    useBridge: false,
    bridgeAgentId: null,
    isActive: true,
  });
  inDevice = created.device;
  inKey = created.webhookKey;
  outKey = (
    await s.a.post("/devices", {
      name: "Chiqish",
      serialNumber: null,
      ipAddress: null,
      port: 80,
      username: null,
      direction: "OUT",
      location: null,
      useBridge: false,
      bridgeAgentId: null,
      isActive: true,
    })
  ).webhookKey;
  bands = [];
  for (const [name, fromMinute, toMinute] of [
    ["1-3", 1, 3],
    ["3-7", 3, 7],
    ["7+", 7, null],
  ] as const) {
    bands.push(await s.a.post("/attendance/lateness-bands", { name, fromMinute, toMinute }));
  }
});
afterAll(() => t.close());

describe("devices", () => {
  it("shows the key once, never the password; the audit log has no secrets", async () => {
    expect(inKey).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const list = await s.a.get("/devices");
    expect(list).toHaveLength(2);
    const d = list.find((x: { id: string }) => x.id === inDevice.id);
    expect(d).toMatchObject({ hasPassword: true, connection: "UNKNOWN", direction: "IN" });
    expect(JSON.stringify(list)).not.toContain("device-secret-1");
    expect(JSON.stringify(list)).not.toContain(inKey);
    const audit = await t.deps.root.auditLog.findMany({
      where: { entityType: "Device", tenantId: t.defaultTenant.tenant.id },
    });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain("device-secret-1");
    const row = await t.deps.root.device.findUniqueOrThrow({ where: { id: inDevice.id } });
    expect(row.passwordEnc).not.toContain("device-secret-1");
    expect(row.webhookKeyHash).not.toBe(inKey);
  });

  it("a bridge device needs a bridge; names are unique; only admins manage devices", async () => {
    const base = {
      name: "Zal",
      serialNumber: null,
      ipAddress: "10.0.0.5",
      port: 80,
      username: null,
      direction: "BOTH",
      location: null,
      isActive: true,
    };
    expect((await s.a.raw("post", "/devices", { ...base, useBridge: true, bridgeAgentId: null })).status).toBe(400);
    expect(
      (await s.a.raw("post", "/devices", { ...base, name: "Kirish", useBridge: false, bridgeAgentId: null })).body.error
        .details.reason,
    ).toBe("DUPLICATE");
    expect((await api(t, s.teacher2).raw("get", "/devices")).status).toBe(403);
  });

  it("webhook keys never reach the request log", () => {
    expect(maskUrlSecrets(`/api/v1/attendance/hikvision-event/${inKey}?x=1`)).toBe(
      "/api/v1/attendance/hikvision-event/[Redacted]?x=1",
    );
  });
});

describe("webhook", () => {
  it("ignores events while attendance is switched off, but marks the device as seen", async () => {
    const res = await push(inKey, event(code(s.s7a), "08:20:00"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: 0, duplicates: 0, ignored: 1, unmatched: 0 });
    const d = (await s.a.get("/devices")).find((x: { id: string }) => x.id === inDevice.id);
    expect(d.connection).toBe("ONLINE");
    await s.a.put("/attendance/settings", { isEnabled: true });
  });

  it("stores a verified face once; heartbeats, failed checks and strangers are told apart", async () => {
    const first = event(code(s.s7a), "08:25:00");
    expect((await push(inKey, first)).body).toEqual({ accepted: 1, duplicates: 0, ignored: 0, unmatched: 0 });
    expect((await push(inKey, first)).body).toEqual({ accepted: 0, duplicates: 1, ignored: 0, unmatched: 0 });
    expect((await push(inKey, { eventType: "heartBeat" })).body.accepted).toBe(0);
    expect((await push(inKey, event(code(s.s7a), "08:26:00", { subEventType: 76 }))).body.ignored).toBe(1);
    expect((await push(inKey, event("STD-9999", "08:27:00"))).body.unmatched).toBe(1);
    // Too far in the future (device clock wrong) or not an event at all.
    const future = { ...event(code(s.s7a), "08:00:00"), dateTime: at("08:00:00", addSchoolDays(schoolToday(), 2)) };
    expect((await push(inKey, future)).body.ignored).toBe(1);
    expect((await push(inKey, { hello: "world" })).body).toEqual({
      accepted: 0,
      duplicates: 0,
      ignored: 0,
      unmatched: 0,
    });
  });

  it("reads Hikvision multipart pushes (JSON part + picture); the picture is not stored", async () => {
    const res = await request(t.app)
      .post(`/api/v1/attendance/hikvision-event/${inKey}`)
      .field("event_log", JSON.stringify(event(code(s.s7b), "08:36:30")))
      .attach("Picture", Buffer.from([0xff, 0xd8, 0xff, 0x00]), { filename: "pic.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);
    expect(
      await t.deps.root.fileAsset.count({ where: { kind: "FACE_PHOTO", tenantId: t.defaultTenant.tenant.id } }),
    ).toBe(0);
  });

  it("concurrent pushes of the same event store it once", async () => {
    const same = event(code(s.s7b), "08:40:00");
    const results = await Promise.all(Array.from({ length: 6 }, () => push(inKey, same)));
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(results.reduce((n, r) => n + (r.body.accepted as number), 0)).toBe(1);
    expect(results.reduce((n, r) => n + (r.body.duplicates as number), 0)).toBe(5);
  });

  it("the exit camera gives the departure and early leave", async () => {
    expect((await push(outKey, event(code(s.s7a), "12:00:00"))).body.accepted).toBe(1);
  });

  it("unknown and archived devices get 404", async () => {
    expect((await push("x".repeat(43), { eventType: "heartBeat" })).status).toBe(404);
    const rotated = await s.a.post(`/devices/${inDevice.id}/rotate-key`);
    expect((await push(inKey, { eventType: "heartBeat" })).status).toBe(404);
    inKey = rotated.webhookKey;
    expect((await push(inKey, { eventType: "heartBeat" })).status).toBe(200);
  });
});

describe("school attendance", () => {
  it("the day: on time, late with its band, absent; counts by status", async () => {
    const day = await s.a.get(`/attendance/day?date=${DAY}`);
    const row = (id: string) => day.items.find((r: { studentId: string }) => r.studentId === id);
    expect(row(s.s7a.id)).toMatchObject({
      status: "PRESENT",
      lateMinutes: 0,
      firstInAt: new Date(at("08:25:00")).toISOString(),
      lastOutAt: new Date(at("12:00:00")).toISOString(),
      earlyLeaveMinutes: 90,
    });
    // 08:36:30 against the default 08:30 start: 6 minutes late → band 3-7.
    expect(row(s.s7b.id)).toMatchObject({ status: "LATE", lateMinutes: 6, latenessBandName: "3-7" });
    expect(row(s.s4a.id)).toMatchObject({ status: "ABSENT", firstInAt: null });
    expect(day.counts).toMatchObject({ PRESENT: 1, LATE: 1, ABSENT: 1 });
    expect((await s.a.get(`/attendance/day?date=${DAY}&status=LATE`)).items).toHaveLength(1);
  });

  it("a day without any terminal event is no data, never an absence", async () => {
    let quiet = addSchoolDays(DAY, -1);
    while (isoWeekday(quiet) === 7) quiet = addSchoolDays(quiet, -1);
    const day = await s.a.get(`/attendance/day?date=${quiet}`);
    expect(day.items.length).toBeGreaterThan(0);
    expect(day.counts).toMatchObject({ NO_DATA: day.items.length, ABSENT: 0 });
    const history = await s.a.get(`/attendance/students/${s.s4a.id}?from=${quiet}&to=${DAY}`);
    expect(history.days.map((d: { date: string }) => d.date)).toEqual([DAY]);
  });

  it("class teachers see their class only; subject teachers have no access", async () => {
    const day = await api(t, s.teacher2).get(`/attendance/day?date=${DAY}`);
    expect(day.items.map((r: { studentId: string }) => r.studentId)).toEqual([s.s7b.id]);
    expect((await api(t, s.teacher1).raw("get", `/attendance/day?date=${DAY}`)).status).toBe(403);
    expect((await api(t, s.teacher2).raw("get", `/attendance/students/${s.s7a.id}`)).status).toBe(404);
  });

  it("guardians and students see their own history only", async () => {
    const own = await api(t, s.guardian).get(`/attendance/students/${s.s7b.id}?from=${DAY}&to=${DAY}`);
    expect(own.days).toEqual([expect.objectContaining({ date: DAY, status: "LATE", latenessBandName: "3-7" })]);
    expect((await api(t, s.guardian).raw("get", `/attendance/students/${s.s7a.id}`)).status).toBe(404);
    const student = await studentAuth(t, s, s.s7a.id, t.defaultTenant.tenant.slug);
    const mine = await api(t, student).get(`/attendance/students/${s.s7a.id}?from=${DAY}&to=${DAY}`);
    expect(mine.days[0]).toMatchObject({ status: "PRESENT" });
    expect((await api(t, student).raw("get", `/attendance/day`)).status).toBe(403);
  });

  it("a manual mark wins and keeps the device result; clearing it restores the device status", async () => {
    const path = `/attendance/students/${s.s4a.id}/days/${DAY}`;
    expect((await s.a.raw("put", path, { status: "EXCUSED", reason: "" })).status).toBe(400);
    const marked = await s.a.put(path, { status: "EXCUSED", reason: "Kasal (ma'lumotnoma)" });
    expect(marked.days[0]).toMatchObject({ status: "EXCUSED", manualStatus: "EXCUSED" });
    const late = await s.a.put(`/attendance/students/${s.s7b.id}/days/${DAY}`, {
      status: "PRESENT",
      reason: "Qurilma soati noto'g'ri",
    });
    expect(late.days[0]).toMatchObject({ status: "PRESENT", lateMinutes: 6 });
    const cleared = await s.a.post(`${path}/clear`, { reason: "Xato belgilangan" });
    expect(cleared.days[0]).toMatchObject({ status: "ABSENT", manualStatus: null });
    const future = addSchoolDays(schoolToday(), 1);
    expect(
      (await s.a.raw("put", `/attendance/students/${s.s4a.id}/days/${future}`, { status: "ABSENT", reason: "x" }))
        .status,
    ).toBe(400);
    expect((await api(t, s.teacher2).raw("put", path, { status: "ABSENT", reason: "x" })).status).toBe(403);
    const audit = await t.deps.root.auditLog.findMany({
      where: { tenantId: t.defaultTenant.tenant.id, action: { in: ["attendance.mark", "attendance.clear_mark"] } },
    });
    expect(audit).toHaveLength(3);
  });

  it("events and monitoring", async () => {
    const events = await s.a.get(`/attendance/events?date=${DAY}&unmatched=true`);
    expect(events.items.map((e: { employeeNo: string }) => e.employeeNo)).toEqual(["STD-9999"]);
    const m = await s.a.get("/attendance/monitoring");
    expect(m.devices.online).toBe(2);
    expect(m.faces.none).toBe(3);
  });
});

describe("settings and bands", () => {
  it("bands never overlap; a used band keeps its range; deleting it archives it", async () => {
    expect(
      (await s.a.raw("post", "/attendance/lateness-bands", { name: "x", fromMinute: 5, toMinute: 8 })).status,
    ).toBe(400);
    const used = bands[1]!;
    expect(
      (await s.a.raw("put", `/attendance/lateness-bands/${used.id}`, { name: "4-7", fromMinute: 4, toMinute: 7 })).body
        .error.details.reason,
    ).toBe("BAND_IN_USE");
    expect(
      (await s.a.put(`/attendance/lateness-bands/${used.id}`, { name: "3-7 daqiqa", fromMinute: 3, toMinute: 7 })).name,
    ).toBe("3-7 daqiqa");
    expect(await s.a.raw("delete", `/attendance/lateness-bands/${used.id}`).then((r) => r.body)).toEqual({
      deleted: false,
    });
    const unused = bands[0]!;
    expect(await s.a.raw("delete", `/attendance/lateness-bands/${unused.id}`).then((r) => r.body)).toEqual({
      deleted: true,
    });
  });

  it("settings are validated", async () => {
    expect(
      (await s.a.raw("put", "/attendance/settings", { defaultStartMinute: 900, defaultEndMinute: 800 })).status,
    ).toBe(400);
    const cur = await s.a.get("/attendance/settings");
    expect(cur).toMatchObject({ isEnabled: true, encryptionConfigured: true, acceptedSubEvents: [75] });
  });

  it("bad keys are rate limited", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await push(`bad-${"k".repeat(20)}-${i}`, {})).status;
    expect(last).toBe(429);
  });
});

// Audit phase 5 (T-76): employees on Face ID — their face needs a phone and an employee code, the terminal number is
// "E-" + code, their passes are matched to them (not "unmatched"), and the staff day reads first IN / last OUT against
// the staff working day. Days without any terminal data are no data, never absences.
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addSchoolDays, isoWeekday, schoolToday, type SchoolDate } from "@idrok/shared/time";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let key: string;
let photo: Buffer;

/** A past working day, so absence is final. */
const DAY = (() => {
  let d = addSchoolDays(schoolToday(), -1);
  while (isoWeekday(d) === 7) d = addSchoolDays(d, -1);
  return d;
})();
let serial = 5000;
const pass = (employeeNo: string, time: string, date: SchoolDate = DAY) =>
  request(t.app)
    .post(`/api/v1/attendance/hikvision-event/${key}`)
    .send({
      ipAddress: "192.168.1.64",
      dateTime: `${date}T${time}+05:00`,
      eventType: "AccessControllerEvent",
      AccessControllerEvent: { majorEventType: 5, subEventType: 75, employeeNoString: employeeNo, serialNo: serial++ },
    });
const upload = (employeeId: string) =>
  request(t.app)
    .put(`/api/v1/face/employees/${employeeId}/photo`)
    .set(s.adminAuthHeaders)
    .attach("file", photo, { filename: "face.png", contentType: "image/png" });

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  await s.a.put("/attendance/settings", { isEnabled: true, staffStartMinute: 480, staffEndMinute: 1020 });
  key = (
    await s.a.post("/devices", {
      name: "Xodimlar kirishi",
      serialNumber: null,
      ipAddress: null,
      port: 80,
      username: null,
      direction: "BOTH",
      location: null,
      useBridge: false,
      bridgeAgentId: null,
      isActive: true,
    })
  ).webhookKey;
  photo = await sharp({ create: { width: 400, height: 500, channels: 3, background: "#a08070" } })
    .png()
    .toBuffer();
});
afterAll(() => t.close());

describe("staff faces", () => {
  it("need an employee code and the employee's own phone", async () => {
    await s.a.patch(`/employees/${s.emp1.id}`, { employeeCode: null, phone: null });
    expect((await upload(s.emp1.id)).body.error.details.reason).toBe("EMPLOYEE_CODE_REQUIRED");
    await s.a.patch(`/employees/${s.emp1.id}`, { employeeCode: "T001" });
    expect((await upload(s.emp1.id)).body.error.details.reason).toBe("EMPLOYEE_PHONE_REQUIRED");
    await s.a.patch(`/employees/${s.emp1.id}`, { phone: "+998 90 111 22 33" });
  });

  it("are stored without a guardian consent and sent to terminals as E-<code>", async () => {
    const res = await upload(s.emp1.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ employeeCode: "T001", hasPhoto: true, overall: "PENDING" });
    const job = await t.deps.root.bridgeJob.findFirstOrThrow({
      where: { tenantId: t.defaultTenant.tenant.id, type: "FACE_UPSERT" },
      orderBy: { createdAt: "desc" },
    });
    expect(job.payload).toMatchObject({ employeeNo: "E-T001", name: "Ustoz Bir Demo" });
    const list = await s.a.get("/face/employees?q=ustoz");
    expect(list.items.find((e: { employeeId: string }) => e.employeeId === s.emp1.id)).toMatchObject({
      hasPhoto: true,
      phone: "+998901112233",
    });
    expect((await api(t, s.teacher1).raw("get", "/face/employees")).status).toBe(403);
  });

  it("removing deletes the face here and queues its removal", async () => {
    await s.a.patch(`/employees/${s.emp2.id}`, { employeeCode: "T002", phone: "+998 90 444 55 66" });
    expect((await upload(s.emp2.id)).status).toBe(200);
    const after = (await s.a.raw("delete", `/face/employees/${s.emp2.id}/photo`)).body;
    expect(after).toMatchObject({ hasPhoto: false, overall: "NONE" });
  });
});

describe("staff attendance", () => {
  it("passes are matched to the employee; the day shows lateness against the staff day", async () => {
    expect((await pass("E-T001", "08:07:00")).body).toMatchObject({ accepted: 1, unmatched: 0 });
    expect((await pass("E-T001", "16:30:00")).body.accepted).toBe(1);
    expect((await pass("E-NOBODY", "08:00:00")).body.unmatched).toBe(1);
    const event = await t.deps.root.accessEvent.findFirstOrThrow({ where: { employeeNo: "E-T001" } });
    expect(event).toMatchObject({ employeeId: s.emp1.id, studentId: null });

    const day = await s.a.get(`/attendance/staff/day?date=${DAY}`);
    const row = day.items.find((r: { employeeId: string }) => r.employeeId === s.emp1.id);
    expect(row).toMatchObject({
      status: "LATE",
      lateMinutes: 7,
      earlyLeaveMinutes: 30,
      hasFace: true,
      firstInAt: new Date(`${DAY}T08:07:00+05:00`).toISOString(),
      lastOutAt: new Date(`${DAY}T16:30:00+05:00`).toISOString(),
    });
    expect(day.counts.LATE).toBe(1);
  });

  it("an enrolled employee without passes on a tracked day is absent; a day with no data is not", async () => {
    await s.a.patch(`/employees/${s.emp2.id}`, { employeeCode: "T002", phone: "+998 90 444 55 66" });
    expect((await upload(s.emp2.id)).status).toBe(200);
    const day = await s.a.get(`/attendance/staff/day?date=${DAY}`);
    expect(day.items.find((r: { employeeId: string }) => r.employeeId === s.emp2.id).status).toBe("ABSENT");
    let quiet = addSchoolDays(DAY, -1);
    while (isoWeekday(quiet) === 7) quiet = addSchoolDays(quiet, -1);
    const none = await s.a.get(`/attendance/staff/day?date=${quiet}`);
    expect(none.counts).toMatchObject({ NO_DATA: none.total, ABSENT: 0 });
  });

  it("staff passes do not count as unmatched; only staff managers see the staff day", async () => {
    const m = await s.a.get("/attendance/monitoring");
    expect(m).toHaveProperty("unmatchedToday");
    const events = await s.a.get(`/attendance/events?date=${DAY}&unmatched=true`);
    expect(events.items.map((e: { employeeNo: string }) => e.employeeNo)).toEqual(["E-NOBODY"]);
    const all = await s.a.get(`/attendance/events?date=${DAY}`);
    expect(all.items.find((e: { employeeNo: string }) => e.employeeNo === "E-T001")).toMatchObject({
      employeeName: "Ustoz Bir Demo",
    });
    expect((await api(t, s.teacher2).raw("get", `/attendance/staff/day?date=${DAY}`)).status).toBe(403);
    expect((await s.a.raw("put", "/attendance/settings", { staffStartMinute: 600, staffEndMinute: 540 })).status).toBe(
      400,
    );
  });
});

describe("staff days off from the school calendar (T-86)", () => {
  const yearPath = () => `/academic-years/${s.year.id}`;

  it("a school holiday: only those who came are listed, without lateness; nobody is absent", async () => {
    await s.a.post(`${yearPath()}/calendar-days`, { date: DAY, kind: "HOLIDAY", title: "Bayram" });
    const day = await s.a.get(`/attendance/staff/day?date=${DAY}`);
    expect(day.workingDay).toBe(false);
    expect(day.items.map((r: { employeeId: string }) => r.employeeId)).toEqual([s.emp1.id]);
    expect(day.items[0]).toMatchObject({ status: "PRESENT", lateMinutes: 0, earlyLeaveMinutes: 0 });
    expect(day.counts.ABSENT).toBe(0);
  });

  it("student vacations are working days for the staff; Sunday is not", async () => {
    let other = addSchoolDays(DAY, -1);
    while (isoWeekday(other) === 7) other = addSchoolDays(other, -1);
    await s.a.post(`${yearPath()}/calendar-days`, { date: other, kind: "VACATION", title: "Ta'til" });
    expect((await s.a.get(`/attendance/staff/day?date=${other}`)).workingDay).toBe(true);
    let sunday = DAY;
    while (isoWeekday(sunday) !== 7) sunday = addSchoolDays(sunday, -1);
    expect((await s.a.get(`/attendance/staff/day?date=${sunday}`)).workingDay).toBe(false);
  });
});

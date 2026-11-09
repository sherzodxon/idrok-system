// M6 step 3: face photos (normalised, encrypted), sync jobs to terminals through the bridge protocol and directly from
// the worker, against the Hikvision simulator: leases, supersession, checks, removal, students who left, relayed and
// history events, token rotation and device info.
import { IsapiClient, runDeviceJob } from "@idrok/hikvision";
import { HikvisionSimulator } from "@idrok/hikvision/simulator";
import { runWithTenant } from "@idrok/db";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addSchoolDays, schoolToday } from "@idrok/shared/time";
import { leaseJobs, MAX_ATTEMPTS } from "../src/modules/attendance/device-jobs";
import { FaceService } from "../src/modules/attendance/face.service";
import { cipherFor } from "../src/modules/attendance/attendance.routes";
import { maintenance, startWorker } from "../src/worker";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let worker: Awaited<ReturnType<typeof startWorker>>;
const simA = new HikvisionSimulator({ password: "pw-bridge" });
const simB = new HikvisionSimulator({ password: "pw-direct", serialNumber: "SIM-B-0002", model: "DS-K1T671M" });
let bridgeToken: string;
let bridgeId: string;
let deviceA: { id: string };
let deviceB: { id: string };
let photo: Buffer;

const bridge = () => ({ Authorization: `Bearer ${bridgeToken}` });
const b = (method: "get" | "post", path: string, body?: object) => {
  const r = request(t.app)[method](`/api/v1${path}`).set(bridge());
  return body ? r.send(body) : r;
};
const profile = (studentId: string) => s.a.get(`/face/students/${studentId}`);
const stateOn = async (studentId: string, deviceId: string) =>
  (await profile(studentId)).devices.find((d: { deviceId: string }) => d.deviceId === deviceId);

/** One bridge poll: heartbeat, lease, run every job against simulator A, report. */
async function bridgePoll(): Promise<number> {
  const hb = await b("post", "/bridge/heartbeat", {
    version: "test",
    hostname: "MAKTAB-PC",
    queueDepth: 0,
    devices: [{ deviceId: deviceA.id, reachable: true }],
  });
  expect(hb.status).toBe(200);
  const dev = hb.body.devices[0];
  const client = new IsapiClient({
    host: dev.ipAddress,
    port: dev.port,
    username: dev.username,
    password: dev.password,
  });
  const jobs = (await b("post", "/bridge/jobs/lease", { max: 20 })).body as {
    id: string;
    type: string;
    payload: Record<string, unknown>;
  }[];
  for (const job of jobs) {
    const outcome = await runDeviceJob(client, job as never, async () => {
      const r = await b("get", `/bridge/jobs/${job.id}/photo`).buffer(true);
      expect(r.status).toBe(200);
      return r.body as Buffer;
    });
    if (outcome.events?.length)
      await b("post", "/bridge/events", { deviceId: deviceA.id, source: "HISTORY", events: outcome.events });
    const res = await b("post", `/bridge/jobs/${job.id}/result`, {
      ok: outcome.ok,
      error: outcome.error ?? null,
      result: outcome.result ?? null,
    });
    expect(res.body.recorded).toBe(true);
  }
  return jobs.length;
}

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  while (!(await fn())) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 150));
  }
}

const upload = (studentId: string, file: Buffer) =>
  request(t.app)
    .put(`/api/v1/face/students/${studentId}/photo`)
    .set(s.adminAuthHeaders)
    .attach("file", file, { filename: "face.png", contentType: "image/png" });

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  await s.a.put("/attendance/settings", { isEnabled: true });
  // T-75: faces are stored only with a guardian consent on record.
  for (const st of [s.s7a, s.s7b, s.s4a])
    await s.a.post(`/face/students/${st.id}/consents`, { givenBy: "Demo vasiy", givenOn: "2026-09-01" });
  const addrA = await simA.start();
  const addrB = await simB.start();
  const created = await s.a.post("/bridge-agents", { name: "Maktab kompyuteri" });
  bridgeToken = created.token;
  bridgeId = created.agent.id;
  const device = (name: string, over: Record<string, unknown>) =>
    s.a.post("/devices", {
      name,
      serialNumber: null,
      port: 80,
      username: "admin",
      direction: "IN",
      location: null,
      isActive: true,
      ...over,
    });
  deviceA = (
    await device("Kirish A", {
      ipAddress: addrA.host,
      port: addrA.port,
      password: "pw-bridge",
      useBridge: true,
      bridgeAgentId: bridgeId,
    })
  ).device;
  deviceB = (
    await device("Kirish B", {
      ipAddress: addrB.host,
      port: addrB.port,
      password: "pw-direct",
      useBridge: false,
      bridgeAgentId: null,
    })
  ).device;
  // A 900×1200 "photo" with some texture (a PNG upload, stored as a JPEG).
  const raw = Buffer.alloc(900 * 1200 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 251;
  photo = await sharp(raw, { raw: { width: 900, height: 1200, channels: 3 } })
    .png()
    .toBuffer();
  worker = await startWorker(t.env, t.deps.logger);
});
afterAll(async () => {
  await worker.stop();
  await simA.stop();
  await simB.stop();
  await t.close();
});

describe("face photos", () => {
  it("are normalised to a small JPEG and stored encrypted", async () => {
    const res = await upload(s.s7a.id, photo);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ hasPhoto: true, version: 1, overall: "PENDING" });
    const jpeg = (
      await request(t.app).get(`/api/v1/face/students/${s.s7a.id}/photo`).set(s.adminAuthHeaders).buffer(true)
    ).body as Buffer;
    expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(jpeg.length).toBeLessThanOrEqual(200 * 1024);
    const meta = await sharp(jpeg).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(640);
    const asset = await t.deps.root.fileAsset.findFirstOrThrow({
      where: { kind: "FACE_PHOTO", status: "READY", tenantId: t.defaultTenant.tenant.id },
    });
    const stored = await t.deps.storage.get(asset.storageKey);
    expect(stored.equals(jpeg)).toBe(false);
    expect(cipherFor(t.deps).decrypt(stored).equals(jpeg)).toBe(true);
  });

  it("refuses non-images and tiny pictures; teachers have no access", async () => {
    expect((await upload(s.s7b.id, Buffer.from("not an image"))).status).toBe(400);
    const tiny = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#888" } })
      .png()
      .toBuffer();
    const res = await upload(s.s7b.id, tiny);
    expect(res.body.error.details.fields[0].code).toBe("too_small");
    expect((await api(t, s.teacher1).raw("get", "/face/profiles")).status).toBe(403);
  });
});

describe("direct device (worker)", () => {
  it("the worker sends the face to a terminal it reaches itself", async () => {
    await waitFor(async () => (await stateOn(s.s7a.id, deviceB.id))?.status === "SYNCED");
    expect(simB.faces.has(s.s7a.studentCode)).toBe(true);
    expect(simB.users.get(s.s7a.studentCode)?.name).toBe("Oquvchi A Demo");
  });

  it("reads device info and the event log after an outage", async () => {
    await s.a.post(`/devices/${deviceB.id}/check`);
    await waitFor(
      async () => (await s.a.get("/devices")).find((d: { id: string }) => d.id === deviceB.id).model === "DS-K1T671M",
    );
    const day = addSchoolDays(schoolToday(), -1);
    // The terminal saw the student while the webhook was unreachable.
    await simB.scan(s.s7a.studentCode, { at: new Date(`${day}T08:20:00+05:00`) });
    await s.a.post(`/devices/${deviceB.id}/history`, { from: day, to: day });
    await waitFor(async () => (await s.a.get(`/attendance/events?date=${day}&deviceId=${deviceB.id}`)).total === 1);
    const ev = await t.deps.root.accessEvent.findFirstOrThrow({ where: { deviceId: deviceB.id } });
    expect(ev.source).toBe("HISTORY");
    expect(
      (await s.a.raw("post", `/devices/${deviceB.id}/history`, { from: day, to: addSchoolDays(day, 9) })).status,
    ).toBe(400);
  });
});

describe("bridge", () => {
  it("rejects bad tokens; the heartbeat hands out its devices with their credentials", async () => {
    expect(
      (await request(t.app).post("/api/v1/bridge/jobs/lease").set({ Authorization: "Bearer nope" }).send({})).status,
    ).toBe(401);
    const hb = await b("post", "/bridge/heartbeat", {
      version: "1.0.0",
      hostname: "MAKTAB-PC",
      queueDepth: 3,
      devices: [],
    });
    expect(hb.body.devices).toEqual([expect.objectContaining({ id: deviceA.id, password: "pw-bridge" })]);
    expect(hb.body).toMatchObject({ pollSeconds: 10, rotateToken: false });
    const agents = await s.a.get("/bridge-agents");
    expect(agents[0]).toMatchObject({ connection: "ONLINE", version: "1.0.0", queueDepth: 3, deviceCount: 1 });
    expect(JSON.stringify(agents)).not.toContain(bridgeToken);
  });

  it("leases the face job, serves its photo and records the result", async () => {
    expect(await bridgePoll()).toBe(1);
    expect(simA.faces.has(s.s7a.studentCode)).toBe(true);
    expect(await stateOn(s.s7a.id, deviceA.id)).toMatchObject({
      status: "SYNCED",
      upToDate: true,
      deviceHasFace: true,
    });
    expect((await profile(s.s7a.id)).overall).toBe("SYNCED");
    expect(await bridgePoll()).toBe(0);
  });

  it("a newer photo supersedes the queued job; only the current one is sent", async () => {
    await upload(s.s7a.id, photo);
    await upload(s.s7a.id, photo);
    expect((await profile(s.s7a.id)).version).toBe(3);
    expect(await bridgePoll()).toBe(1);
    expect(await stateOn(s.s7a.id, deviceA.id)).toMatchObject({ status: "SYNCED", upToDate: true });
    const superseded = await t.deps.root.bridgeJob.count({
      where: { error: "superseded", tenantId: t.defaultTenant.tenant.id },
    });
    expect(superseded).toBeGreaterThanOrEqual(1);
    // Old photos are not kept.
    expect(
      await t.deps.root.fileAsset.count({
        where: { kind: "FACE_PHOTO", status: "READY", tenantId: t.defaultTenant.tenant.id },
      }),
    ).toBe(1);
  });

  it("a job whose bridge never answers is handed out again, then fails", async () => {
    await s.a.post(`/face/students/${s.s7a.id}/resync`, { deviceId: deviceA.id });
    await runWithTenant({ tenantId: t.defaultTenant.tenant.id }, async () => {
      let now = Date.now();
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        expect(await leaseJobs(t.deps.db, { bridgeAgentId: bridgeId }, 5, new Date(now))).toHaveLength(1);
        now += 3 * 60_000;
      }
      expect(await leaseJobs(t.deps.db, { bridgeAgentId: bridgeId }, 5, new Date(now))).toHaveLength(0);
    });
    expect(await stateOn(s.s7a.id, deviceA.id)).toMatchObject({
      status: "FAILED",
      lastError: "no result after repeated leases",
    });
    expect((await profile(s.s7a.id)).overall).toBe("FAILED");
    await s.a.post(`/face/students/${s.s7a.id}/resync`, { deviceId: deviceA.id });
    expect(await bridgePoll()).toBe(1);
    expect((await stateOn(s.s7a.id, deviceA.id)).status).toBe("SYNCED");
  });

  it("checks the terminal, and a device failure is reported", async () => {
    simA.faces.delete(s.s7a.studentCode);
    await s.a.post(`/face/students/${s.s7a.id}/check`);
    await bridgePoll();
    expect(await stateOn(s.s7a.id, deviceA.id)).toMatchObject({ deviceHasFace: false });
    await s.a.post(`/face/students/${s.s7a.id}/resync`, { deviceId: deviceA.id });
    simA.failNext = 1;
    await bridgePoll();
    expect(await stateOn(s.s7a.id, deviceA.id)).toMatchObject({ status: "FAILED" });
    expect((await s.a.get("/devices")).find((d: { id: string }) => d.id === deviceA.id).lastError).toContain("500");
  });

  it("relays live events; a device of another bridge is refused", async () => {
    await s.a.post(`/face/students/${s.s7a.id}/resync`, { deviceId: deviceA.id });
    await bridgePoll();
    const ev = simA.pushBody({
      serialNo: 9001,
      time: `${addSchoolDays(schoolToday(), -1)}T08:10:00+05:00`,
      employeeNo: s.s7a.studentCode,
      minor: 75,
    });
    expect(
      (await b("post", "/bridge/events", { deviceId: deviceA.id, source: "WEBHOOK", events: [ev] })).body.accepted,
    ).toBe(1);
    expect((await b("post", "/bridge/events", { deviceId: deviceB.id, source: "WEBHOOK", events: [ev] })).status).toBe(
      404,
    );
  });

  it("rotates its own token with an overlap; an admin rotation cuts the old token at once", async () => {
    const old = bridgeToken;
    bridgeToken = (await b("post", "/bridge/token/rotate")).body.token;
    expect(
      (
        await request(t.app)
          .post("/api/v1/bridge/jobs/lease")
          .set({ Authorization: `Bearer ${old}` })
          .send({})
      ).status,
    ).toBe(200);
    expect((await b("post", "/bridge/jobs/lease", {})).status).toBe(200);
    const admin = await s.a.post(`/bridge-agents/${bridgeId}/rotate-token`);
    expect((await b("post", "/bridge/jobs/lease", {})).status).toBe(401);
    bridgeToken = admin.token;
    expect((await b("post", "/bridge/jobs/lease", {})).status).toBe(200);
  });
});

describe("removal", () => {
  it("removing the photo deletes the face from every terminal and the server", async () => {
    const asset = await t.deps.root.fileAsset.findFirstOrThrow({
      where: { kind: "FACE_PHOTO", status: "READY", tenantId: t.defaultTenant.tenant.id },
    });
    const res = await s.a.raw("delete", `/face/students/${s.s7a.id}/photo`);
    expect(res.body).toMatchObject({ hasPhoto: false, overall: "NONE" });
    await expect(t.deps.storage.get(asset.storageKey)).rejects.toThrow();
    await bridgePoll();
    expect(simA.users.has(s.s7a.studentCode)).toBe(false);
    await waitFor(async () => !simB.users.has(s.s7a.studentCode));
    expect(await stateOn(s.s7a.id, deviceA.id)).toMatchObject({ action: "DELETE", status: "SYNCED" });
  });

  it("students who left lose their face in maintenance", async () => {
    expect((await upload(s.s7b.id, photo)).status).toBe(200);
    await bridgePoll();
    expect(simA.faces.has(s.s7b.studentCode)).toBe(true);
    await t.deps.root.student.update({ where: { id: s.s7b.id }, data: { status: "LEFT" } });
    await maintenance(worker.deps);
    expect((await profile(s.s7b.id)).hasPhoto).toBe(false);
    await bridgePoll();
    expect(simA.users.has(s.s7b.studentCode)).toBe(false);
    // Nothing left to clear the second time.
    expect(
      await runWithTenant({ tenantId: t.defaultTenant.tenant.id }, () =>
        new FaceService(t.deps.db, t.deps.storage, cipherFor(t.deps)).removeInactive(),
      ),
    ).toBe(0);
  });

  it("a new terminal gets every face at once", async () => {
    expect((await upload(s.s4a.id, photo)).status).toBe(200);
    expect(await s.a.post(`/devices/${deviceA.id}/sync-faces`)).toEqual({ queued: 1 });
    await bridgePoll();
    expect(simA.faces.has(s.s4a.studentCode)).toBe(true);
  });
});

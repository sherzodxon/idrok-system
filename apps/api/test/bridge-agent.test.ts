// M6 step 4: the real bridge agent between the API and a simulated terminal — face upload, live pushes through the
// bridge's disk outbox, an internet/server outage (events wait on disk), a bridge outage (events read back from the
// terminal's log) and token rotation.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeAgent, saveSetup, silentLogger } from "@idrok/bridge";
import { HikvisionSimulator } from "@idrok/hikvision/simulator";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addSchoolDays, schoolToday } from "@idrok/shared/time";
import { createTestApp } from "./support/app";
import { buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let server: Server;
let port = 0;
let dataDir: string;
let agent: BridgeAgent;
let bridgeId: string;
let device: { id: string };
const sim = new HikvisionSimulator({ password: "pw-agent" });

const listen = () =>
  new Promise<void>((resolve) => {
    server = createServer(t.app);
    server.listen(port, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
const newAgent = () =>
  new BridgeAgent({
    serverUrl: `http://127.0.0.1:${port}/api/v1`,
    dataDir,
    listenPort: 0,
    listenHost: "127.0.0.1",
    log: silentLogger,
    autoPoll: false,
  });
const YESTERDAY = addSchoolDays(schoolToday(), -1);
const eventsOfDay = async () =>
  (await s.a.get(`/attendance/events?date=${YESTERDAY}&deviceId=${device.id}`)).items as {
    employeeNo: string;
    source: string;
  }[];

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  await s.a.put("/attendance/settings", { isEnabled: true });
  await listen();
  const addr = await sim.start();
  const created = await s.a.post("/bridge-agents", { name: "Agent" });
  bridgeId = created.agent.id;
  device = (
    await s.a.post("/devices", {
      name: "Kirish",
      serialNumber: null,
      ipAddress: addr.host,
      port: addr.port,
      username: "admin",
      password: "pw-agent",
      direction: "IN",
      location: null,
      useBridge: true,
      bridgeAgentId: bridgeId,
      isActive: true,
    })
  ).device;
  dataDir = await mkdtemp(join(tmpdir(), "bridge-it-"));
  await saveSetup(dataDir, { serverUrl: `http://127.0.0.1:${port}/api/v1` }, created.token);
  agent = newAgent();
  await agent.start();
  await agent.tick();
  sim.webhookUrl = `http://127.0.0.1:${agent.listenPort}/hik/${device.id}`;
});
afterAll(async () => {
  await sim.stop();
  await close().catch(() => undefined);
  await t.close();
});

describe("bridge agent", () => {
  it("reports itself and its terminal", async () => {
    const [b] = await s.a.get("/bridge-agents");
    expect(b).toMatchObject({ connection: "ONLINE", version: "0.1.0" });
    const status = await agent.status();
    expect(status).toMatchObject({ serverReachable: true, outboxEvents: 0 });
    expect(status.devices).toEqual([expect.objectContaining({ id: device.id, reachable: true })]);
  });

  it("puts an uploaded face on the terminal", async () => {
    const raw = await sharp({ create: { width: 400, height: 500, channels: 3, background: "#a08070" } })
      .png()
      .toBuffer();
    await request(t.app)
      .put(`/api/v1/face/students/${s.s7a.id}/photo`)
      .set(s.adminAuthHeaders)
      .attach("file", raw, { filename: "f.png", contentType: "image/png" })
      .expect(200);
    await agent.tick();
    expect(sim.faces.has(s.s7a.studentCode)).toBe(true);
    expect((await s.a.get(`/face/students/${s.s7a.id}`)).overall).toBe("SYNCED");
  });

  it("relays live pushes through its disk outbox", async () => {
    expect((await sim.scan(s.s7a.studentCode, { at: new Date(`${YESTERDAY}T08:21:00+05:00`) })).pushed).toBe(true);
    await agent.tick();
    expect((await eventsOfDay()).map((e) => e.source)).toEqual(["WEBHOOK"]);
  });

  it("keeps events on disk while the server is down and delivers them later", async () => {
    await close();
    expect((await sim.scan(s.s7b.studentCode, { at: new Date(`${YESTERDAY}T08:31:00+05:00`) })).pushed).toBe(true);
    await agent.tick();
    expect((await agent.status()).serverReachable).toBe(false);
    expect((await agent.status()).outboxEvents).toBe(1);
    await listen();
    await agent.tick();
    expect((await agent.status()).outboxEvents).toBe(0);
    expect((await eventsOfDay()).map((e) => e.employeeNo).sort()).toEqual(
      [s.s7a.studentCode, s.s7b.studentCode].sort(),
    );
  });

  it("reads back what the terminal saw while the bridge was down", async () => {
    await agent.stop();
    // Seen just now, while the service was stopped (the push finds nobody listening).
    expect((await sim.scan(s.s4a.studentCode)).pushed).toBe(false);
    // The service starts again: its first poll reads the terminal's log for the gap.
    agent = newAgent();
    await agent.start();
    await agent.tick();
    const today = await s.a.get(`/attendance/events?date=${schoolToday()}&deviceId=${device.id}`);
    expect(today.items).toEqual([expect.objectContaining({ employeeNo: s.s4a.studentCode, source: "HISTORY" })]);
    // A second read of an overlapping window stores nothing twice.
    await agent.tick();
    agent["lastCatchUp"].clear();
    await agent.tick();
    expect((await s.a.get(`/attendance/events?date=${schoolToday()}&deviceId=${device.id}`)).total).toBe(1);
    expect(await eventsOfDay()).toHaveLength(2);
  });

  it("rotates its token when the server asks, keeping it on disk", async () => {
    const before = JSON.parse(await readFile(join(dataDir, "token"), "utf8")).token as string;
    await t.deps.root.bridgeAgent.update({
      where: { id: bridgeId },
      data: { tokenRotatedAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    await agent.tick();
    const after = JSON.parse(await readFile(join(dataDir, "token"), "utf8")).token as string;
    expect(after).not.toBe(before);
    await agent.tick();
    expect((await agent.status()).serverReachable).toBe(true);
  });
});

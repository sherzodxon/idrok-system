// ISAPI client against the simulator: Digest auth, user and face records, face search, the event log, job outcomes.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { digestHeader, IsapiClient, parseChallenge, runDeviceJob } from "../src";
import { HikvisionSimulator } from "../src/simulator";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
let sim: HikvisionSimulator;
let client: IsapiClient;
let target: { host: string; port: number };

beforeAll(async () => {
  sim = new HikvisionSimulator({ password: "pw-1" });
  target = await sim.start();
  client = new IsapiClient({ ...target, username: "admin", password: "pw-1", timeoutMs: 3000 });
});
afterAll(() => sim.stop());

describe("digest", () => {
  it("parses challenges and computes the RFC 2617 example response", () => {
    const c = parseChallenge(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
    );
    expect(c.realm).toBe("testrealm@host.com");
    const h = digestHeader(c, { username: "Mufasa", password: "Circle Of Life" }, "GET", "/dir/index.html", "0a4f113b");
    expect(h).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(h).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
  });

  it("a wrong password is refused", async () => {
    const bad = new IsapiClient({ ...target, username: "admin", password: "nope" });
    await expect(bad.deviceInfo()).rejects.toMatchObject({ status: 401 });
  });
});

describe("client", () => {
  it("device info", async () => {
    expect(await client.deviceInfo()).toMatchObject({ model: "DS-K1T341AMF", firmwareVersion: "V3.2.30" });
  });

  it("user, face, search and delete", async () => {
    await expect(client.uploadFace("STD-0001", JPEG)).rejects.toMatchObject({ subStatusCode: "deviceUserNotExist" });
    await client.setUpUser({ employeeNo: "STD-0001", name: "Aliyev Ali" });
    await client.uploadFace("STD-0001", JPEG);
    expect(await client.hasFace("STD-0001")).toBe(true);
    await client.deleteFace("STD-0001");
    expect(await client.hasFace("STD-0001")).toBe(false);
    await client.deleteUser("STD-0001");
    await client.deleteUser("STD-0001");
    expect(sim.users.has("STD-0001")).toBe(false);
  });

  it("reads the event log page by page in pushed-event shape", async () => {
    const base = Date.UTC(2026, 10, 11, 3, 0);
    for (let i = 0; i < 35; i++) await sim.scan(`STD-${i}`, { at: new Date(base + i * 60_000) });
    await sim.scan("STD-X", { at: new Date(base), minor: 76 });
    const events = await client.searchEvents("2026-11-11T08:00:00+05:00", "2026-11-11T08:20:00+05:00");
    expect(events).toHaveLength(21);
    expect(events[0]).toMatchObject({
      eventType: "AccessControllerEvent",
      dateTime: "2026-11-11T08:00:00+05:00",
      AccessControllerEvent: { majorEventType: 5, subEventType: 75, employeeNoString: "STD-0" },
    });
  });
});

describe("jobs", () => {
  it("upsert replaces the face; delete removes the person; failures become outcomes", async () => {
    const photo = async () => JPEG;
    expect(
      await runDeviceJob(client, { id: "1", type: "FACE_UPSERT", payload: { employeeNo: "STD-7", name: "A" } }, photo),
    ).toEqual({ ok: true, result: { hasFace: true } });
    expect(sim.requests.slice(-3)).toEqual([
      "PUT /ISAPI/AccessControl/UserInfo/SetUp",
      "PUT /ISAPI/Intelligent/FDLib/FDSearch/Delete",
      "POST /ISAPI/Intelligent/FDLib/FaceDataRecord",
    ]);
    expect(
      await runDeviceJob(client, { id: "2", type: "FACE_CHECK", payload: { employeeNo: "STD-7" } }, photo),
    ).toEqual({ ok: true, result: { hasFace: true } });
    expect(
      (await runDeviceJob(client, { id: "3", type: "FACE_DELETE", payload: { employeeNo: "STD-7" } }, photo)).ok,
    ).toBe(true);
    expect(sim.faces.has("STD-7")).toBe(false);
    sim.failNext = 1;
    const failed = await runDeviceJob(client, { id: "4", type: "DEVICE_INFO", payload: {} }, photo);
    expect(failed.ok).toBe(false);
    const missing = await runDeviceJob(client, { id: "5", type: "FACE_CHECK", payload: {} }, photo);
    expect(missing).toEqual({ ok: false, error: "payload.employeeNo missing" });
  });

  it("an unreachable device is a failed outcome, without the password", async () => {
    const down = new IsapiClient({
      host: "127.0.0.1",
      port: 1,
      username: "admin",
      password: "secret-pw",
      timeoutMs: 500,
    });
    const r = await runDeviceJob(down, { id: "6", type: "DEVICE_INFO", payload: {} }, async () => JPEG);
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain("secret-pw");
  });
});

describe("simulator pushes", () => {
  it("pushes multipart events to the webhook; failed pushes stay in the log", async () => {
    const received: string[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString("latin1")));
      req.on("end", () => {
        received.push(body);
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    sim.webhookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    const ok = await sim.scan("STD-0042", { attendanceStatus: "checkIn" });
    expect(ok.pushed).toBe(true);
    expect(received[0]).toContain('name="event_log"');
    expect(received[0]).toContain('"employeeNoString":"STD-0042"');
    await new Promise<void>((r) => server.close(() => r()));
    expect((await sim.scan("STD-0043")).pushed).toBe(false);
    expect(sim.failedPushes.map((e) => e.employeeNo)).toEqual(["STD-0043"]);
    sim.webhookUrl = null;
  });
});

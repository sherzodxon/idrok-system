// Bridge disk outbox (atomic, ordered, survives broken files) and the LAN listener (source address check, multipart
// pushes, heartbeats skipped, local status only).
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventsOf, PushListener } from "../src/listener";
import { silentLogger } from "../src/log";
import { DiskQueue } from "../src/store";

const DEVICE = "0190f5a0-0000-7000-8000-000000000001";

describe("disk queue", () => {
  it("keeps order, removes confirmed items, sets broken ones aside and drops temp leftovers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-q-"));
    await writeFile(join(dir, "x.json.abcd.tmp"), "half");
    const q = new DiskQueue<{ n: number }>(dir);
    await q.init();
    for (let n = 0; n < 5; n++) await q.push({ n });
    await writeFile(join(dir, "000000000000000-broken.json"), "{not json");
    const first = await q.peek(10);
    expect(first.map((i) => i.value.n)).toEqual([0, 1, 2, 3, 4]);
    await q.remove(first.slice(0, 2).map((i) => i.id));
    expect(await q.size()).toBe(3);
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
    expect(files.some((f) => f.endsWith(".broken"))).toBe(true);
    // A new queue on the same directory (service restart) sees the same items.
    const again = new DiskQueue<{ n: number }>(dir);
    await again.init();
    expect((await again.peek(10)).map((i) => i.value.n)).toEqual([2, 3, 4]);
  });
});

describe("listener", () => {
  const stored: unknown[] = [];
  let expectedIp: string | null = "127.0.0.1";
  const listener = new PushListener({
    devices: () => new Map([[DEVICE, expectedIp]]),
    store: async (e) => {
      stored.push(e);
    },
    status: async () => ({ ok: true }),
    log: silentLogger,
  });
  let port = 0;
  beforeAll(async () => {
    port = await listener.start(0, "127.0.0.1");
  });
  afterAll(() => listener.stop());

  const event = {
    eventType: "AccessControllerEvent",
    dateTime: "2026-11-11T08:25:00+05:00",
    AccessControllerEvent: {},
  };

  it("stores multipart and JSON pushes from the terminal's address; skips heartbeats", async () => {
    const form = new FormData();
    form.append("event_log", JSON.stringify(event));
    form.append("Picture", new Blob([new Uint8Array([0xff, 0xd8])], { type: "image/jpeg" }), "p.jpg");
    expect((await fetch(`http://127.0.0.1:${port}/hik/${DEVICE}`, { method: "POST", body: form })).status).toBe(200);
    const json = await fetch(`http://127.0.0.1:${port}/hik/${DEVICE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "heartBeat" }),
    });
    expect(json.status).toBe(200);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ deviceId: DEVICE, event });
  });

  it("refuses unknown terminals and other addresses", async () => {
    expect((await fetch(`http://127.0.0.1:${port}/hik/${DEVICE.replace("1", "2")}`, { method: "POST" })).status).toBe(
      404,
    );
    expectedIp = "192.168.1.64";
    expect((await fetch(`http://127.0.0.1:${port}/hik/${DEVICE}`, { method: "POST", body: "{}" })).status).toBe(403);
    expectedIp = "127.0.0.1";
  });

  it("status is served to this PC", async () => {
    expect(await (await fetch(`http://127.0.0.1:${port}/status`)).json()).toEqual({ ok: true });
  });

  it("reads event parts of any name", () => {
    expect(eventsOf(Buffer.from(JSON.stringify(event)), "application/json")).toEqual([event]);
    expect(eventsOf(Buffer.from("nope"), "application/json")).toEqual([]);
  });
});

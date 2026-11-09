// Error alerts: only a short, masked summary leaves the server; repeats are throttled; a failing receiver never
// breaks the request; an unhandled API error triggers one.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorHandler } from "../src/http/errors";
import { alertMessage, createAlertSink, noAlerts, type Alert } from "../src/infra/alerts";
import { createTestApp } from "./support/app";

describe("alert sink", () => {
  it("is off without a URL", () => {
    expect(createAlertSink(undefined, { service: "api", environment: "test" })).toBe(noAlerts);
  });

  it("sends a masked one-line summary, at most once per throttle window", async () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    let clock = 1_000_000;
    const sink = createAlertSink("https://alerts.example.test/hook", {
      service: "api",
      environment: "test",
      throttleMs: 60_000,
      now: () => clock,
      fetchImpl: (async (url: string, init: { body: string }) => {
        sent.push({ url, body: JSON.parse(init.body) });
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch,
    });
    const alert: Alert = {
      kind: "api_error",
      message: "Error: boom\n    at stack line",
      requestId: "r1",
      route: "POST /api/v1/attendance/hikvision-event/SECRETKEY123",
    };
    sink.notify(alert);
    sink.notify(alert);
    clock += 61_000;
    sink.notify(alert);
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body).toMatchObject({ service: "api", kind: "api_error", message: "Error: boom", requestId: "r1" });
    expect(String(sent[0]!.body.route)).not.toContain("SECRETKEY123");
  });

  it("never throws when the receiver is down; quoted values are dropped from messages", async () => {
    const sink = createAlertSink("https://alerts.example.test/hook", {
      service: "worker",
      environment: "test",
      fetchImpl: (() => Promise.reject(new Error("down"))) as unknown as typeof fetch,
    });
    expect(() => sink.notify({ kind: "worker_error", message: "x" })).not.toThrow();
    expect(alertMessage(new Error('Unique constraint failed on "phone" for "+998901112233"'))).toBe(
      "Error: Unique constraint failed on … for …",
    );
  });
});

describe("API errors", () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  const got: Alert[] = [];
  beforeAll(async () => {
    t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
    t.app.locals.alerts = { notify: (a: Alert) => got.push(a) };
  });
  afterAll(() => t.close());

  it("an unhandled error answers 500 with the request id and raises one alert", () => {
    const alerts: Alert[] = [];
    let status = 0;
    let sent: unknown;
    const req = {
      app: { locals: { alerts: { notify: (a: Alert) => alerts.push(a) } } },
      method: "GET",
      originalUrl: "/api/v1/students?q=Aliyeva",
      id: "req-42",
      log: { error: () => undefined },
    };
    const res = { status: (s: number) => ((status = s), { json: (b: unknown) => (sent = b) }) };
    errorHandler(new TypeError("cannot read x"), req as never, res as never, () => undefined);
    expect(status).toBe(500);
    expect(sent).toMatchObject({ error: { code: "INTERNAL_ERROR", details: { requestId: "req-42" } } });
    // The query string (here a name) never leaves the server.
    expect(alerts).toEqual([
      { kind: "api_error", message: "TypeError: cannot read x", requestId: "req-42", route: "GET /api/v1/students" },
    ]);
  });

  it("an expected error (404) is not an alert", async () => {
    await request(t.app).get("/api/v1/no-such-route").expect(404);
    expect(got).toEqual([]);
  });
});

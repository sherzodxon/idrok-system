import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const logger = pino({ level: "silent" });

describe("health endpoints", () => {
  it("GET /api/v1/healthz is always ok", async () => {
    const res = await request(createApp({ logger, readiness: {} })).get("/api/v1/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /api/v1/readyz is 200 when every dependency answers", async () => {
    const app = createApp({ logger, readiness: { db: async () => {}, redis: async () => {} } });
    const res = await request(app).get("/api/v1/readyz");
    expect(res.status).toBe(200);
    expect(res.body.checks).toEqual({ db: "ok", redis: "ok" });
  });

  it("GET /api/v1/readyz is 503 and names the failing dependency", async () => {
    const failing = async () => {
      throw new Error("down");
    };
    const res = await request(createApp({ logger, readiness: { db: async () => {}, redis: failing } })).get(
      "/api/v1/readyz",
    );
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ db: "ok", redis: "fail" });
  });
});

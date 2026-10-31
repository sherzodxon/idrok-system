import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { healthRouter } from "../src/http/health";

const app = (checks: Parameters<typeof healthRouter>[0]) => express().use(healthRouter(checks));

describe("health endpoints", () => {
  it("GET /healthz is always ok", async () => {
    const res = await request(app({})).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /readyz is 200 when every dependency answers", async () => {
    const res = await request(app({ db: async () => {}, redis: async () => {} })).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body.checks).toEqual({ db: "ok", redis: "ok" });
  });

  it("GET /readyz is 503 and names the failing dependency", async () => {
    const failing = async () => {
      throw new Error("down");
    };
    const res = await request(app({ db: async () => {}, redis: failing })).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ db: "ok", redis: "fail" });
  });
});

// security-baseline.md S3 / implementation-plan step 8: real requests that carry passwords and tokens — login, refresh,
// account creation, password reset and change, a failing request — leave no secret in the log stream (level trace).
import { Writable } from "node:stream";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger";
import { PASSWORD, createTestApp } from "./support/app";
import { api, bearerFor } from "./support/school";

const lines: string[] = [];
const stream = new Writable({
  write(chunk: Buffer, _enc, done) {
    lines.push(chunk.toString());
    done();
  },
});

let t: Awaited<ReturnType<typeof createTestApp>>;
const secrets: string[] = [PASSWORD];

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" }, createLogger("trace", stream));
});
afterAll(() => t.close());

const cookieValues = (res: request.Response) =>
  ([] as string[]).concat(res.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]!.split("=")[1]!);

describe("no secrets in logs", () => {
  it("covers the requests that carry secrets", async () => {
    const admin = await t.defaultTenant.createUser("SCHOOL_ADMIN");

    // Cookie login + refresh: tokens travel in cookies.
    const web = await request(t.app).post("/api/v1/auth/login").send({ username: admin.username, password: PASSWORD });
    expect(web.status).toBe(200);
    secrets.push(...cookieValues(web));
    const refreshed = await request(t.app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", web.headers["set-cookie"] as unknown as string[])
      .set("X-CSRF-Token", cookieValues(web).at(-1)!);
    secrets.push(...cookieValues(refreshed));

    // Bearer login: tokens in the body; the access token then travels in a header.
    const auth = await bearerFor(t, admin.username);
    secrets.push(auth.Authorization.slice("Bearer ".length));
    const a = api(t, auth);

    // Wrong password (logged as a failed login).
    await request(t.app).post("/api/v1/auth/login").send({ username: admin.username, password: "Notog'ri-parol-77" });
    secrets.push("Notog'ri-parol-77");

    // Temporary passwords: account creation and admin reset.
    const employee = await a.post("/employees", { firstName: "Demo", lastName: "Xodim" });
    const account = await a.post(`/employees/${employee.id}/account`, {});
    secrets.push(account.temporaryPassword);
    const reset = await a.post(`/users/${account.userId}/reset-password`);
    secrets.push(reset.temporaryPassword);

    // Password change, including a rejected one (validation error path).
    const user = await bearerFor(t, account.username, reset.temporaryPassword);
    const weak = await request(t.app)
      .post("/api/v1/auth/change-password")
      .set(user)
      .send({ currentPassword: reset.temporaryPassword, newPassword: "short" });
    expect(weak.status).toBe(400);
    const changed = await request(t.app)
      .post("/api/v1/auth/change-password")
      .set(user)
      .send({ currentPassword: reset.temporaryPassword, newPassword: "Yangi-parol-2026" });
    expect(changed.status).toBeLessThan(300);
    secrets.push("Yangi-parol-2026");
  });

  it("the log has the requests but none of the secrets", () => {
    const log = lines.join("");
    expect(lines.length).toBeGreaterThanOrEqual(10);
    expect(log).toContain("/auth/login");
    const leaked = secrets.filter((s) => s && s.length >= 8 && log.includes(s));
    expect(leaked).toEqual([]);
  });
});

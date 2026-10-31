// security-baseline.md S2: username and IP limits are independent; the client IP comes only from `trust proxy`.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";

describe("behind one proxy (TRUST_PROXY=1)", () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    t = await createTestApp({ TRUST_PROXY: "1" });
  });
  afterAll(() => t.close());

  it("changing X-Forwarded-For on every attempt does not reset the username limit", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    const attempt = (i: number) =>
      request(t.app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `203.0.113.${i}`)
        .send({ username: user.username, password: "xato-parol", clientType: "MOBILE" });
    for (let i = 1; i <= 5; i++) expect((await attempt(i)).status).toBe(401);
    const sixth = await attempt(6);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe("AUTH_RATE_LIMITED");
  });

  it("an unknown user and a wrong password get exactly the same answer", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    const send = (username: string, ip: string) =>
      request(t.app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", ip)
        .send({ username, password: "xato-parol", clientType: "MOBILE" });
    const wrong = await send(user.username, "198.51.100.1");
    const unknown = await send("bunday_foydalanuvchi_yoq", "198.51.100.2");
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body).toEqual({
      error: { code: "AUTH_INVALID_CREDENTIALS", message: "errors.AUTH_INVALID_CREDENTIALS" },
    });
  });
});

describe("without a trusted proxy (TRUST_PROXY=0, default)", () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it("a forged X-Forwarded-For is ignored, so the IP limit cannot be dodged", async () => {
    // 30 failures from one real IP with different usernames and forged headers → the 31st is blocked by IP.
    for (let i = 0; i < 30; i++) {
      const res = await request(t.app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `192.0.2.${i}`)
        .send({ username: `yoq_${i}`, password: "x", clientType: "MOBILE" });
      expect(res.status).toBe(401);
    }
    const blocked = await request(t.app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "192.0.2.250")
      .send({ username: "yangi_odam", password: "x", clientType: "MOBILE" });
    expect(blocked.status).toBe(429);
  });
});

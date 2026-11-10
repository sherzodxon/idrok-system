import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PASSWORD, createTestApp } from "./support/app";

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const login = (username: string, password = PASSWORD, clientType: "WEB" | "MOBILE" = "MOBILE") =>
  request(t.app).post("/api/v1/auth/login").send({ username, password, clientType });

function cookies(res: request.Response): Record<string, string> {
  const raw = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  return Object.fromEntries(raw.map((c) => c.split(";")[0]!.split("=") as [string, string]));
}

describe("login", () => {
  it("bearer mode returns tokens and the profile", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    const res = await login(user.username);
    expect(res.status).toBe(200);
    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.tokens.refreshToken).toBeTruthy();
    expect(res.body.user.roles).toEqual(["TEACHER"]);
    expect(res.body.user.permissions).toContain("students.view");
    expect(res.headers["set-cookie"]).toBeUndefined();

    const me = await request(t.app).get("/api/v1/me").set("Authorization", `Bearer ${res.body.tokens.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);
    // Without a bot token and webhook secret the Telegram feature is off and the UI hides it.
    expect(me.body.features).toEqual({ telegram: false });
  });

  it("cookie mode sets httpOnly access/refresh cookies and a readable CSRF cookie", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    const res = await login(user.username, PASSWORD, "WEB");
    expect(res.status).toBe(200);
    expect(res.body.tokens).toBeUndefined();
    const raw = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
    expect(raw.find((c) => c.startsWith("idrok_at="))).toMatch(/HttpOnly/);
    expect(raw.find((c) => c.startsWith("idrok_rt="))).toMatch(/HttpOnly.*|Path=\/api\/v1\/auth/);
    expect(raw.find((c) => c.startsWith("idrok_csrf="))).not.toMatch(/HttpOnly/);
  });

  it("the same error for a wrong password and an unknown user", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    const wrong = await login(user.username, "noto'g'ri-parol");
    const unknown = await login("hech_kim_yoq");
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({ code: "AUTH_INVALID_CREDENTIALS", message: "errors.AUTH_INVALID_CREDENTIALS" });
    }
  });

  it("locks the username after 5 failures (6th attempt is 429 even with the right password)", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    for (let i = 0; i < 5; i++) expect((await login(user.username, "xato")).status).toBe(401);
    const res = await login(user.username);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("AUTH_RATE_LIMITED");
    expect(res.body.error.details.retryAfterSec).toBeGreaterThan(0);
  });

  it("guardians log in with their phone number in any format", async () => {
    const user = await t.defaultTenant.createUser("GUARDIAN", { username: "+998901112233" });
    expect((await login("90 111 22 33")).status).toBe(200);
    expect(user.username).toBe("+998901112233");
  });

  it("disabled accounts cannot log in", async () => {
    const user = await t.defaultTenant.createUser("TEACHER", { status: "DISABLED" });
    expect((await login(user.username)).status).toBe(401);
  });
});

describe("refresh rotation", () => {
  it("rotates, tolerates a parallel refresh briefly, then treats reuse as theft", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    const first = (await login(user.username)).body.tokens;

    const second = await request(t.app).post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken });
    expect(second.status).toBe(200);
    expect(second.body.tokens.refreshToken).not.toBe(first.refreshToken);

    // Within the grace period the old token only renews the access token.
    const parallel = await request(t.app).post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken });
    expect(parallel.status).toBe(200);
    expect(parallel.body.tokens.refreshToken).toBeUndefined();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11_000);
    try {
      const reused = await request(t.app).post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken });
      expect(reused.status).toBe(401);
      expect(reused.body.error.code).toBe("AUTH_SESSION_REVOKED");
      // The whole session is gone: the newest refresh token and the access token stop working too.
      const latest = await request(t.app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: second.body.tokens.refreshToken });
      expect(latest.status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
    const me = await request(t.app).get("/api/v1/me").set("Authorization", `Bearer ${second.body.tokens.accessToken}`);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe("AUTH_SESSION_REVOKED");
  });

  it("cookie-mode refresh needs the CSRF header", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    const c = cookies(await login(user.username, PASSWORD, "WEB"));
    const cookie = `idrok_rt=${c.idrok_rt}; idrok_csrf=${c.idrok_csrf}`;
    const without = await request(t.app).post("/api/v1/auth/refresh").set("Cookie", cookie).send({});
    expect(without.status).toBe(403);
    const withHeader = await request(t.app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", c.idrok_csrf!)
      .send({});
    expect(withHeader.status).toBe(200);
    expect(cookies(withHeader).idrok_rt).toBeTruthy();
  });
});

describe("sessions and logout", () => {
  it("logout revokes the session immediately", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    const { accessToken } = (await login(user.username)).body.tokens;
    const auth = { Authorization: `Bearer ${accessToken}` };
    expect((await request(t.app).post("/api/v1/auth/logout").set(auth)).status).toBe(204);
    const me = await request(t.app).get("/api/v1/me").set(auth);
    expect(me.status).toBe(401);
  });

  it("lists my sessions and revokes another one", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    const a = (await login(user.username)).body.tokens.accessToken;
    const b = (await login(user.username)).body.tokens.accessToken;
    const list = await request(t.app).get("/api/v1/auth/sessions").set("Authorization", `Bearer ${a}`);
    expect(list.body).toHaveLength(2);
    const other = list.body.find((s: { current: boolean }) => !s.current);
    expect(
      (await request(t.app).delete(`/api/v1/auth/sessions/${other.id}`).set("Authorization", `Bearer ${a}`)).status,
    ).toBe(204);
    expect((await request(t.app).get("/api/v1/me").set("Authorization", `Bearer ${b}`)).status).toBe(401);
  });
});

describe("password change", () => {
  it("first login: only auth endpoints and GET /me until the password is changed", async () => {
    const user = await t.defaultTenant.createUser("SCHOOL_ADMIN", { mustChangePassword: true });
    const tokens = (await login(user.username)).body.tokens;
    const auth = { Authorization: `Bearer ${tokens.accessToken}` };

    expect((await request(t.app).get("/api/v1/me").set(auth)).body.mustChangePassword).toBe(true);
    const blocked = await request(t.app).get("/api/v1/roles").set(auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const weak = await request(t.app)
      .post("/api/v1/auth/change-password")
      .set(auth)
      .send({ currentPassword: PASSWORD, newPassword: "abcdefgh" });
    expect(weak.status).toBe(422);
    expect(weak.body.error.details.reason).toBe("NEEDS_LETTER_AND_DIGIT");

    const ok = await request(t.app)
      .post("/api/v1/auth/change-password")
      .set(auth)
      .send({ currentPassword: PASSWORD, newPassword: "Yangi-parol-77" });
    expect(ok.status).toBe(204);
    expect((await request(t.app).get("/api/v1/roles").set(auth)).status).toBe(200);
    expect((await login(user.username, "Yangi-parol-77")).status).toBe(200);
  });

  it("revokes the user's other sessions", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    const a = (await login(user.username)).body.tokens.accessToken;
    const b = (await login(user.username)).body.tokens.accessToken;
    await request(t.app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${a}`)
      .send({ currentPassword: PASSWORD, newPassword: "Boshqa-parol-55" })
      .expect(204);
    expect((await request(t.app).get("/api/v1/me").set("Authorization", `Bearer ${a}`)).status).toBe(200);
    expect((await request(t.app).get("/api/v1/me").set("Authorization", `Bearer ${b}`)).status).toBe(401);
  });
});

describe("CSRF (cookie mode)", () => {
  it("rejects state-changing requests without the header, accepts them with it", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    const c = cookies(await login(user.username, PASSWORD, "WEB"));
    const cookie = `idrok_at=${c.idrok_at}; idrok_csrf=${c.idrok_csrf}`;
    const without = await request(t.app)
      .patch("/api/v1/me/preferences")
      .set("Cookie", cookie)
      .send({ themeMode: "DARK" });
    expect(without.status).toBe(403);
    expect(without.body.error.code).toBe("CSRF_TOKEN_INVALID");
    const ok = await request(t.app)
      .patch("/api/v1/me/preferences")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", c.idrok_csrf!)
      .send({ themeMode: "DARK" });
    expect(ok.status).toBe(200);
    expect(ok.body.themeMode).toBe("DARK");
    // GET needs no CSRF header.
    expect((await request(t.app).get("/api/v1/me").set("Cookie", cookie)).body.preferences.themeMode).toBe("DARK");
  });
});

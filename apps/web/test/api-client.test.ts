import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "../src/lib/api-client";

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const err = (status: number, code: string) => json(status, { error: { code, message: `errors.${code}` } });

function setup(responses: Response[], cookies: Record<string, string> = { idrok_csrf: "csrf-1" }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next;
  });
  const onSessionLost = vi.fn();
  const api = createApiClient({
    baseUrl: "http://api/v1",
    fetch: fetchMock as unknown as typeof fetch,
    readCookie: (n) => cookies[n],
    onSessionLost,
  });
  return { api, calls, onSessionLost };
}

describe("api client", () => {
  it("sends credentials and the CSRF header on writes only", async () => {
    const { api, calls } = setup([json(200, { ok: 1 }), json(200, { ok: 2 })]);
    await api.get("/me");
    await api.patch("/me/preferences", { themeMode: "DARK" });
    expect(calls[0]!.init.credentials).toBe("include");
    expect((calls[0]!.init.headers as Record<string, string>)["X-CSRF-Token"]).toBeUndefined();
    expect((calls[1]!.init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-1");
  });

  it("refreshes once on an expired token and retries the request", async () => {
    const { api, calls, onSessionLost } = setup([
      err(401, "AUTH_TOKEN_EXPIRED"),
      json(200, {}),
      json(200, { id: "me" }),
    ]);
    await expect(api.get("/me")).resolves.toEqual({ id: "me" });
    expect(calls.map((c) => c.url)).toEqual(["http://api/v1/me", "http://api/v1/auth/refresh", "http://api/v1/me"]);
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it("parallel 401s share one refresh", async () => {
    const { api, calls } = setup([
      err(401, "AUTH_REQUIRED"),
      err(401, "AUTH_REQUIRED"),
      json(200, {}),
      json(200, { a: 1 }),
      json(200, { b: 2 }),
    ]);
    await Promise.all([api.get("/a"), api.get("/b")]);
    expect(calls.filter((c) => c.url.endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("a revoked session goes to the login page without a refresh", async () => {
    const { api, calls, onSessionLost } = setup([err(401, "AUTH_SESSION_REVOKED")]);
    await expect(api.get("/me")).rejects.toMatchObject({ code: "AUTH_SESSION_REVOKED", status: 401 });
    expect(calls).toHaveLength(1);
    expect(onSessionLost).toHaveBeenCalledOnce();
  });

  it("a failed refresh ends the session", async () => {
    const { api, onSessionLost } = setup([err(401, "AUTH_TOKEN_EXPIRED"), err(401, "AUTH_SESSION_REVOKED")]);
    await expect(api.get("/me")).rejects.toBeInstanceOf(ApiError);
    expect(onSessionLost).toHaveBeenCalledOnce();
  });

  it("login failures are plain errors (no refresh, no redirect)", async () => {
    const { api, calls, onSessionLost } = setup([err(401, "AUTH_INVALID_CREDENTIALS")]);
    await expect(api.post("/auth/login", {})).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect(calls).toHaveLength(1);
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it("maps network failures and keeps error details", async () => {
    const offline = createApiClient({
      baseUrl: "http://api/v1",
      fetch: (async () => {
        throw new TypeError("offline");
      }) as unknown as typeof fetch,
      readCookie: () => undefined,
      onSessionLost: () => {},
    });
    await expect(offline.get("/me")).rejects.toMatchObject({ code: "NETWORK", status: 0 });
    const { api } = setup([
      json(429, { error: { code: "AUTH_RATE_LIMITED", message: "x", details: { retryAfterSec: 90 } } }),
    ]);
    await expect(api.post("/auth/login", {})).rejects.toMatchObject({ details: { retryAfterSec: 90 } });
  });
});

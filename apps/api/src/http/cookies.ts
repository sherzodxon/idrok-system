import type { CookieOptions, Response } from "express";
import type { Env } from "../config/env";

export const ACCESS_COOKIE = "idrok_at";
export const REFRESH_COOKIE = "idrok_rt";
export const CSRF_COOKIE = "idrok_csrf";
export const CSRF_HEADER = "x-csrf-token";
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

function base(env: Env): CookieOptions {
  return { secure: env.COOKIE_SECURE, sameSite: "lax", ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}) };
}

export function setAccessCookie(res: Response, env: Env, token: string) {
  res.cookie(ACCESS_COOKIE, token, {
    ...base(env),
    httpOnly: true,
    path: "/",
    maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
}

export function setRefreshCookies(res: Response, env: Env, refreshToken: string, csrfToken: string) {
  const maxAge = env.REFRESH_TOKEN_TTL_DAYS * 86_400_000;
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base(env), httpOnly: true, path: REFRESH_COOKIE_PATH, maxAge });
  // Readable by the web app, which echoes it in X-CSRF-Token (double-submit).
  res.cookie(CSRF_COOKIE, csrfToken, { ...base(env), httpOnly: false, path: "/", maxAge });
}

export function clearAuthCookies(res: Response, env: Env) {
  res.clearCookie(ACCESS_COOKIE, { ...base(env), path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...base(env), path: REFRESH_COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE, { ...base(env), path: "/" });
}

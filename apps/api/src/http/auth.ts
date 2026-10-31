import { timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { runWithTenant } from "@idrok/db";
import type { PermissionCode } from "@idrok/shared";
import type { AppDeps } from "../deps";
import type { AuthState } from "../modules/access/auth-state";
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER } from "./cookies";
import { AppError } from "./errors";

export interface RequestAuth extends AuthState {
  sessionId: string;
  via: "cookie" | "bearer";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmenting Express' global Request type
  namespace Express {
    interface Request {
      auth?: RequestAuth;
      authFailure?: "expired" | "revoked" | "invalid";
    }
  }
}

function readToken(req: Request): { token: string; via: RequestAuth["via"] } | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return { token: header.slice(7).trim(), via: "bearer" };
  const cookie = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
  return cookie ? { token: cookie, via: "cookie" } : null;
}

/**
 * Identifies the caller when a token is present (anonymous requests pass through). The rest of the request runs inside
 * the tenant context taken from the verified token — never from the request body.
 */
export function authenticate(deps: AppDeps): RequestHandler {
  return async (req, _res, next) => {
    const found = readToken(req);
    if (!found) return next();
    const claims = await deps.tokens.verifyAccess(found.token);
    if (claims === "expired") {
      req.authFailure = "expired";
      return next();
    }
    if (!claims) {
      req.authFailure = "invalid";
      return next();
    }
    const { state, revoked } = await deps.authState.load(claims.userId, claims.sessionId);
    if (revoked || !state || !state.active || state.tenantId !== claims.tenantId) {
      req.authFailure = "revoked";
      return next();
    }
    req.auth = { ...state, sessionId: claims.sessionId, via: found.via };
    runWithTenant({ tenantId: state.tenantId, userId: state.userId, requestId: String(req.id) }, next);
  };
}

const FAILURE_CODES = {
  expired: "AUTH_TOKEN_EXPIRED",
  revoked: "AUTH_SESSION_REVOKED",
  invalid: "AUTH_REQUIRED",
} as const;

export function authRequiredError(req: Request): AppError {
  return new AppError(req.authFailure ? FAILURE_CODES[req.authFailure] : "AUTH_REQUIRED", 401);
}

export function requireAuth(req: Request): RequestAuth {
  if (!req.auth) throw authRequiredError(req);
  return req.auth;
}

export function requirePermission(req: Request, code: PermissionCode): RequestAuth {
  const auth = requireAuth(req);
  if (!auth.permissions.includes(code)) throw new AppError("FORBIDDEN", 403, { permission: code });
  return auth;
}

export function requireAnyPermission(req: Request, codes: readonly PermissionCode[]): RequestAuth {
  const auth = requireAuth(req);
  if (!codes.some((c) => auth.permissions.includes(c)))
    throw new AppError("FORBIDDEN", 403, { permission: codes.join("|") });
  return auth;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfTokensMatch(req: Request): boolean {
  const header = req.headers[CSRF_HEADER];
  const cookie = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
  if (typeof header !== "string" || !cookie || header.length !== cookie.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(cookie));
}

/** Cookie-authenticated state-changing requests must echo the CSRF cookie in X-CSRF-Token. */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (req.auth?.via === "cookie" && !SAFE_METHODS.has(req.method) && !csrfTokensMatch(req)) {
    return next(new AppError("CSRF_TOKEN_INVALID", 403));
  }
  next();
};

/** Until the temporary password is changed, only auth endpoints and GET /me are reachable. */
export const passwordChangeGate: RequestHandler = (req, _res, next) => {
  if (!req.auth?.mustChangePassword) return next();
  const allowed = req.path.startsWith("/auth/") || (req.method === "GET" && req.path === "/me");
  next(allowed ? undefined : new AppError("PASSWORD_CHANGE_REQUIRED", 403));
};

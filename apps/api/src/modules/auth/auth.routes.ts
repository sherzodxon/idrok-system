import type { Request, Response, Router } from "express";
import { z } from "zod";
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  RefreshRequestSchema,
  SessionSchema,
  TokenPairSchema,
} from "@idrok/shared";
import { runWithTenant } from "@idrok/db";
import { telegramEnabled } from "../../config/env";
import type { AppDeps } from "../../deps";
import { csrfTokensMatch } from "../../http/auth";
import { REFRESH_COOKIE, clearAuthCookies, setAccessCookie, setRefreshCookies } from "../../http/cookies";
import { AppError } from "../../http/errors";
import { defineRoute } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { MeService } from "../me/me.service";
import { AuthService, type LoginResult } from "./auth.service";

const IdParams = z.object({ id: z.uuid() });

export function authRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const service = new AuthService(deps);
  const me = new MeService(deps.db, { telegram: telegramEnabled(deps.env) });

  /** Cookie clients get cookies; bearer clients get the tokens in the body. */
  function deliver(res: Response, result: LoginResult, cookieMode: boolean) {
    if (cookieMode) {
      setAccessCookie(res, deps.env, result.tokens.accessToken);
      if (result.tokens.refreshToken && result.tokens.csrfToken) {
        setRefreshCookies(res, deps.env, result.tokens.refreshToken, result.tokens.csrfToken);
      }
      return undefined;
    }
    const { csrfToken: _csrf, ...tokens } = result.tokens;
    return tokens;
  }

  async function profile(result: LoginResult) {
    const state = await deps.authState.fromDb(result.userId);
    if (!state) throw new AppError("AUTH_SESSION_REVOKED", 401);
    return runWithTenant({ tenantId: result.tenantId, userId: result.userId }, () =>
      me.get({ ...state, sessionId: result.sessionId, via: "bearer" }),
    );
  }

  const clientIp = (req: Request) => req.ip ?? "unknown";

  defineRoute(
    router,
    registry,
    {
      method: "post",
      path: "/auth/login",
      summary: "Log in (cookie mode for WEB, tokens in the body for MOBILE/TELEGRAM)",
      tags: ["auth"],
      access: "public",
      body: LoginRequestSchema,
      responses: {
        200: { description: "Logged in", schema: LoginResponseSchema },
        401: { description: "AUTH_INVALID_CREDENTIALS" },
        429: { description: "AUTH_RATE_LIMITED" },
      },
    },
    async ({ req, res, body }) => {
      const result = await service.login({
        username: body.username,
        password: body.password,
        clientType: body.clientType,
        ...(body.tenant ? { tenantSlug: body.tenant } : {}),
        ip: clientIp(req),
        ...(req.headers["user-agent"] ? { userAgent: req.headers["user-agent"] } : {}),
      });
      const tokens = deliver(res, result, body.clientType === "WEB");
      res.json({ user: await profile(result), ...(tokens ? { tokens } : {}) });
    },
  );

  defineRoute(
    router,
    registry,
    {
      method: "post",
      path: "/auth/refresh",
      summary: "Rotate the refresh token and get a new access token",
      tags: ["auth"],
      access: "public",
      body: RefreshRequestSchema,
      responses: {
        200: {
          description: "New tokens (body only in bearer mode)",
          schema: z.object({ tokens: TokenPairSchema.optional() }),
        },
        401: { description: "AUTH_SESSION_REVOKED" },
      },
    },
    async ({ req, res, body }) => {
      const cookieToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
      const cookieMode = !body.refreshToken;
      const token = body.refreshToken ?? cookieToken;
      if (!token) throw new AppError("AUTH_REQUIRED", 401);
      if (cookieMode && !csrfTokensMatch(req)) throw new AppError("CSRF_TOKEN_INVALID", 403);
      try {
        const result = await service.refresh(token);
        const tokens = deliver(res, result, cookieMode);
        res.json(tokens ? { tokens } : {});
      } catch (err) {
        if (cookieMode) clearAuthCookies(res, deps.env);
        throw err;
      }
    },
  );

  defineRoute(
    router,
    registry,
    {
      method: "post",
      path: "/auth/logout",
      summary: "End the current session",
      tags: ["auth"],
      access: "authenticated",
      responses: { 204: { description: "Logged out" } },
    },
    async ({ res, auth }) => {
      await service.logout(auth.userId, auth.sessionId, false);
      clearAuthCookies(res, deps.env);
      res.status(204).end();
    },
  );

  defineRoute(
    router,
    registry,
    {
      method: "post",
      path: "/auth/logout-all",
      summary: "End all sessions of the current user",
      tags: ["auth"],
      access: "authenticated",
      responses: { 204: { description: "Logged out everywhere" } },
    },
    async ({ res, auth }) => {
      await service.logout(auth.userId, auth.sessionId, true);
      clearAuthCookies(res, deps.env);
      res.status(204).end();
    },
  );

  defineRoute(
    router,
    registry,
    {
      method: "get",
      path: "/auth/sessions",
      summary: "Active sessions of the current user",
      tags: ["auth"],
      access: "authenticated",
      responses: { 200: { description: "Sessions", schema: z.array(SessionSchema) } },
    },
    async ({ res, auth }) => res.json(await service.listSessions(auth.userId, auth.sessionId)),
  );

  defineRoute(
    router,
    registry,
    {
      method: "delete",
      path: "/auth/sessions/:id",
      summary: "Revoke one of my sessions",
      tags: ["auth"],
      access: "authenticated",
      params: IdParams,
      responses: { 204: { description: "Revoked" }, 404: { description: "NOT_FOUND" } },
    },
    async ({ res, auth, params }) => {
      await service.revokeSession(auth.userId, params.id);
      res.status(204).end();
    },
  );

  defineRoute(
    router,
    registry,
    {
      method: "post",
      path: "/auth/change-password",
      summary: "Change the password (also the mandatory first-login change)",
      tags: ["auth"],
      access: "authenticated",
      body: ChangePasswordRequestSchema,
      responses: {
        204: { description: "Changed; other sessions are revoked" },
        401: { description: "AUTH_INVALID_CREDENTIALS" },
        422: { description: "PASSWORD_TOO_WEAK" },
      },
    },
    async ({ res, auth, body }) => {
      await service.changePassword(auth.userId, auth.sessionId, body.currentPassword, body.newPassword);
      res.status(204).end();
    },
  );
}

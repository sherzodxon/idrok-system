import type { ClientType, Db } from "@idrok/db";
import { normalizeUzPhone } from "@idrok/shared";
import type { Env } from "../../config/env";
import { AppError } from "../../http/errors";
import { SlidingWindow } from "../../infra/rate-limit";
import type { RedisClient } from "../../infra/redis";
import type { AuthStateStore } from "../access/auth-state";
import { writeAudit } from "../audit/audit.service";
import { AuthRepository } from "./auth.repository";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import type { TokenService } from "./tokens";
import { hashToken, newCsrfToken, newRefreshToken } from "./tokens";

const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_FAILURES_PER_USER = 5;
const MAX_FAILURES_PER_IP = 30;
/** A just-rotated refresh token is still honoured this long (parallel tabs refreshing at once). */
const ROTATION_GRACE_MS = 10_000;

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  /** Absent when a grace-period refresh only renews the access token. */
  refreshToken?: string;
  csrfToken?: string;
}

export interface LoginResult {
  userId: string;
  tenantId: string;
  sessionId: string;
  tokens: IssuedTokens;
}

export class AuthService {
  private readonly repo: AuthRepository;
  private readonly failures: SlidingWindow;

  constructor(
    private readonly deps: {
      env: Env;
      root: ConstructorParameters<typeof AuthRepository>[0];
      db: Db;
      redis: RedisClient;
      tokens: TokenService;
      authState: AuthStateStore;
    },
  ) {
    this.repo = new AuthRepository(deps.root);
    this.failures = new SlidingWindow(deps.redis, LOGIN_WINDOW_MS);
  }

  private refreshExpiry() {
    return new Date(Date.now() + this.deps.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  }

  private async issue(
    userId: string,
    tenantId: string,
    sessionId: string,
    refreshToken?: string,
    telegram = false,
  ): Promise<IssuedTokens> {
    const accessToken = await this.deps.tokens.signAccess({ userId, tenantId, sessionId, telegram });
    return {
      accessToken,
      accessTokenExpiresIn: this.deps.tokens.accessTtlSeconds,
      ...(refreshToken ? { refreshToken, csrfToken: newCsrfToken() } : {}),
    };
  }

  async login(input: {
    username: string;
    password: string;
    clientType: ClientType;
    tenantSlug?: string;
    ip: string;
    userAgent?: string;
  }): Promise<LoginResult> {
    const tenant = await this.repo.findTenantBySlug(input.tenantSlug ?? this.deps.env.DEFAULT_TENANT_SLUG);
    const login = input.username.trim().toLowerCase();
    const userKey = `rl:login:user:${tenant?.id ?? "none"}:${login}`;
    const ipKey = `rl:login:ip:${input.ip}`;

    const [byUser, byIp] = await Promise.all([this.failures.state(userKey), this.failures.state(ipKey)]);
    if (byUser.count >= MAX_FAILURES_PER_USER || byIp.count >= MAX_FAILURES_PER_IP) {
      throw new AppError("AUTH_RATE_LIMITED", 429, {
        retryAfterSec: Math.max(byUser.retryAfterSec, byIp.retryAfterSec),
      });
    }

    // Guardians log in with their phone number in any common format.
    const candidates = [login, normalizeUzPhone(login)].filter((v): v is string => !!v);
    const user = tenant?.status === "ACTIVE" ? await this.repo.findUserForLogin(tenant.id, candidates) : null;
    const valid = await verifyPassword(user?.passwordHash ?? null, input.password);

    if (!user || !valid || user.status !== "ACTIVE") {
      await Promise.all([this.failures.hit(userKey), this.failures.hit(ipKey)]);
      if (user) {
        await writeAudit(this.deps.root, {
          tenantId: user.tenantId,
          actorUserId: null,
          action: "auth.login_failed",
          entityType: "User",
          entityId: user.id,
          after: { reason: valid ? "DISABLED" : "BAD_PASSWORD" },
        });
      }
      throw new AppError("AUTH_INVALID_CREDENTIALS", 401);
    }
    await this.failures.reset(userKey);

    const refreshToken = newRefreshToken();
    const session = await this.repo.transaction(async (tx) => {
      const s = await this.repo.createSession(tx, {
        tenantId: user.tenantId,
        userId: user.id,
        clientType: input.clientType,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: this.refreshExpiry(),
        ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 300) } : {}),
      });
      await this.repo.markLogin(tx, user.id);
      await writeAudit(tx, {
        tenantId: user.tenantId,
        actorUserId: user.id,
        action: "auth.login",
        entityType: "AuthSession",
        entityId: s.id,
        after: { clientType: input.clientType },
      });
      return s;
    });

    return {
      userId: user.id,
      tenantId: user.tenantId,
      sessionId: session.id,
      tokens: await this.issue(user.id, user.tenantId, session.id, refreshToken),
    };
  }

  /**
   * Telegram Mini App login (T-92): the caller already verified initData and resolved the link. Opens a TELEGRAM
   * session tied to that link (unlinking revokes it); tokens go in the body.
   */
  async loginTelegram(input: {
    tenantId: string;
    userId: string;
    telegramLinkId: string;
    userAgent?: string;
  }): Promise<LoginResult> {
    const refreshToken = newRefreshToken();
    const session = await this.repo.transaction(async (tx) => {
      const s = await tx.authSession.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          clientType: "TELEGRAM",
          refreshTokenHash: hashToken(refreshToken),
          expiresAt: this.refreshExpiry(),
          telegramLinkId: input.telegramLinkId,
          ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 300) } : {}),
        },
        select: { id: true },
      });
      await this.repo.markLogin(tx, input.userId);
      await writeAudit(tx, {
        tenantId: input.tenantId,
        actorUserId: input.userId,
        action: "auth.login",
        entityType: "AuthSession",
        entityId: s.id,
        after: { clientType: "TELEGRAM", via: "mini_app" },
      });
      return s;
    });
    return {
      userId: input.userId,
      tenantId: input.tenantId,
      sessionId: session.id,
      tokens: await this.issue(input.userId, input.tenantId, session.id, refreshToken, true),
    };
  }

  /** Refresh rotation with reuse detection (architecture.md §4). */
  async refresh(refreshToken: string): Promise<LoginResult> {
    const presented = hashToken(refreshToken);
    const outcome = await this.repo.transaction(async (tx) => {
      const session = await this.repo.lockSessionByTokenHash(tx, presented);
      if (!session || session.revokedAt || session.expiresAt <= new Date()) return { kind: "invalid" as const };

      if (session.refreshTokenHash === presented) {
        const next = newRefreshToken();
        await this.repo.rotate(tx, session.id, presented, hashToken(next), this.refreshExpiry());
        return { kind: "rotated" as const, session, next };
      }

      // An already rotated token came back.
      const withinGrace = session.rotatedAt && Date.now() - session.rotatedAt.getTime() <= ROTATION_GRACE_MS;
      if (withinGrace) {
        await this.repo.touch(tx, session.id);
        return { kind: "grace" as const, session };
      }
      await this.repo.revokeSessions(tx, { id: session.id }, "REUSE_DETECTED");
      await writeAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: null,
        action: "auth.refresh_reuse_detected",
        entityType: "AuthSession",
        entityId: session.id,
      });
      return { kind: "reused" as const, session };
    });

    if (outcome.kind === "invalid") throw new AppError("AUTH_SESSION_REVOKED", 401);
    if (outcome.kind === "reused") {
      await this.deps.authState.markRevoked([outcome.session.id]);
      throw new AppError("AUTH_SESSION_REVOKED", 401);
    }
    const { session } = outcome;
    const state = await this.deps.authState.fromDb(session.userId);
    if (!state?.active) throw new AppError("AUTH_SESSION_REVOKED", 401);
    const tokens = await this.issue(
      session.userId,
      session.tenantId,
      session.id,
      outcome.kind === "rotated" ? outcome.next : undefined,
      session.telegramLinkId !== null,
    );
    return { userId: session.userId, tenantId: session.tenantId, sessionId: session.id, tokens };
  }

  async logout(userId: string, sessionId: string, everywhere: boolean): Promise<void> {
    const revoked = await this.repo.transaction(async (tx) => {
      const rows = await this.repo.revokeSessions(tx, everywhere ? { userId } : { id: sessionId, userId }, "LOGOUT");
      await writeAudit(tx, {
        action: everywhere ? "auth.logout_all" : "auth.logout",
        entityType: "AuthSession",
        entityId: everywhere ? null : sessionId,
        after: { revoked: rows.length },
      });
      return rows;
    });
    await this.deps.authState.markRevoked(revoked.map((r) => r.id));
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.deps.db.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
      select: { id: true, clientType: true, userAgent: true, createdAt: true, lastUsedAt: true },
    });
    return sessions.map((s) => ({
      id: s.id,
      clientType: s.clientType,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const revoked = await this.deps.db.$transaction(async (tx) => {
      const rows = await tx.authSession.updateManyAndReturn({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "USER_REVOKED" },
        select: { id: true },
      });
      if (!rows.length) throw new AppError("NOT_FOUND", 404);
      await writeAudit(tx, { action: "auth.session_revoke", entityType: "AuthSession", entityId: sessionId });
      return rows;
    });
    await this.deps.authState.markRevoked(revoked.map((r) => r.id));
  }

  async changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.deps.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true, passwordHash: true },
    });
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new AppError("AUTH_INVALID_CREDENTIALS", 401);
    }
    const problem =
      passwordProblem(newPassword, user.username) ?? (newPassword === currentPassword ? "SAME_AS_CURRENT" : null);
    if (problem) throw new AppError("PASSWORD_TOO_WEAK", 422, { reason: problem });

    const passwordHash = await hashPassword(newPassword);
    const revoked = await this.deps.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date(), authVersion: { increment: 1 } },
      });
      // Other devices must log in again with the new password.
      const rows = await tx.authSession.updateManyAndReturn({
        where: { userId, revokedAt: null, id: { not: sessionId } },
        data: { revokedAt: new Date(), revokeReason: "PASSWORD_CHANGED" },
        select: { id: true },
      });
      await writeAudit(tx, { action: "auth.password_change", entityType: "User", entityId: userId });
      return rows;
    });
    await this.deps.authState.markRevoked(revoked.map((r) => r.id));
    await this.deps.authState.invalidate([userId]);
  }
}

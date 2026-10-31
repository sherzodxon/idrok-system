// Per-request authorisation state. The token proves identity only; status, roles and permissions are read from a short
// Redis cache (or the DB) on every request, so a role change or a disabled account takes effect immediately.
import type { RootClient } from "@idrok/db";
import { isPermissionCode, type PermissionCode } from "@idrok/shared";
import type { RedisClient } from "../../infra/redis";

export interface AuthState {
  userId: string;
  tenantId: string;
  username: string;
  active: boolean;
  mustChangePassword: boolean;
  roles: string[];
  permissions: PermissionCode[];
}

const STATE_TTL_SECONDS = 60;
const stateKey = (userId: string) => `auth:state:${userId}`;
const revokedKey = (sessionId: string) => `auth:revoked:${sessionId}`;

export class AuthStateStore {
  constructor(
    private readonly root: RootClient,
    private readonly redis: RedisClient,
    private readonly accessTtlSeconds: number,
  ) {}

  /** State of a user plus whether the session is revoked — one Redis round trip in the common case. */
  async load(userId: string, sessionId: string): Promise<{ state: AuthState | null; revoked: boolean }> {
    const [cached, revoked] = await this.redis.mget(stateKey(userId), revokedKey(sessionId));
    if (revoked) return { state: null, revoked: true };
    if (cached) return { state: JSON.parse(cached) as AuthState, revoked: false };
    const state = await this.fromDb(userId);
    if (state) await this.redis.set(stateKey(userId), JSON.stringify(state), "EX", STATE_TTL_SECONDS);
    return { state, revoked: false };
  }

  async fromDb(userId: string): Promise<AuthState | null> {
    const user = await this.root.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        tenantId: true,
        username: true,
        status: true,
        mustChangePassword: true,
        roles: {
          where: { revokedAt: null, role: { archivedAt: null } },
          select: { role: { select: { code: true, permissions: { select: { permissionCode: true } } } } },
        },
      },
    });
    if (!user) return null;
    const permissions = new Set<PermissionCode>();
    for (const r of user.roles) {
      for (const p of r.role.permissions) if (isPermissionCode(p.permissionCode)) permissions.add(p.permissionCode);
    }
    return {
      userId: user.id,
      tenantId: user.tenantId,
      username: user.username,
      active: user.status === "ACTIVE",
      mustChangePassword: user.mustChangePassword,
      roles: user.roles.map((r) => r.role.code).sort(),
      permissions: [...permissions].sort(),
    };
  }

  /** Call after any change to a user's roles, role permissions, password or status. */
  async invalidate(userIds: string[]): Promise<void> {
    if (userIds.length) await this.redis.del(...userIds.map(stateKey));
  }

  /** Revoked sessions are refused immediately, before their access tokens expire. */
  async markRevoked(sessionIds: string[]): Promise<void> {
    if (!sessionIds.length) return;
    const multi = this.redis.multi();
    for (const id of sessionIds) multi.set(revokedKey(id), "1", "EX", this.accessTtlSeconds);
    await multi.exec();
  }
}

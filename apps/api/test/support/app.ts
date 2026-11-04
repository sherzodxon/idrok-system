// Builds the real app against the test database and Redis, plus two seeded tenants.
import { randomUUID } from "node:crypto";
import { ensureSystemRoles, syncPermissions } from "@idrok/db/seed";
import type { SystemRoleCode } from "@idrok/shared";
import { pino, type Logger } from "pino";
import { inject } from "vitest";
import { createApp } from "../../src/app";
import { buildDeps, closeDeps } from "../../src/bootstrap";
import { loadEnv } from "../../src/config/env";
import { hashPassword } from "../../src/modules/auth/password";

export const PASSWORD = "Demo-parol-2026";

export async function createTestApp(
  envOverrides: Record<string, string> = {},
  logger: Logger = pino({ level: "silent" }),
) {
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: inject("databaseUrl"),
    REDIS_URL: inject("redisUrl"),
    JWT_SECRET: "test-secret-test-secret-test-secret-1234",
    COOKIE_SECURE: "false",
    LOG_LEVEL: "silent",
    DEFAULT_TENANT_SLUG: `t-${randomUUID()}`,
    // Not a secret: a fixed key for tests only.
    DATA_ENCRYPTION_KEY: "dGVzdC1vbmx5LWtleS10ZXN0LW9ubHkta2V5LTEyMzQ=",
    ...envOverrides,
  });
  const deps = buildDeps(env, logger);
  await deps.redis.flushdb();
  await syncPermissions(deps.root);
  const app = createApp(deps);

  async function createTenant(slug = `t-${randomUUID()}`) {
    const tenant = await deps.root.tenant.create({ data: { slug, name: "Demo maktab" } });
    const roles = await ensureSystemRoles(deps.root, tenant.id);
    async function createUser(
      role: SystemRoleCode | null,
      options: { username?: string; mustChangePassword?: boolean; status?: "ACTIVE" | "DISABLED" } = {},
    ) {
      const user = await deps.root.user.create({
        data: {
          tenantId: tenant.id,
          username: options.username ?? `demo_${randomUUID().slice(0, 8)}`,
          passwordHash: await hashPassword(PASSWORD),
          mustChangePassword: options.mustChangePassword ?? false,
          status: options.status ?? "ACTIVE",
        },
      });
      if (role)
        await deps.root.userRole.create({ data: { tenantId: tenant.id, userId: user.id, roleId: roles[role] } });
      return user;
    }
    return { tenant, roles, createUser };
  }

  const defaultTenant = await createTenant(env.DEFAULT_TENANT_SLUG);
  return { app, deps, env, createTenant, defaultTenant, close: () => closeDeps(deps) };
}

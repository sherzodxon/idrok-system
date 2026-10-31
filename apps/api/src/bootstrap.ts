import { createDb, createRootClient } from "@idrok/db";
import type { Env } from "./config/env";
import type { AppDeps } from "./deps";
import { createRedis } from "./infra/redis";
import { createLogger } from "./logger";
import { AuthStateStore } from "./modules/access/auth-state";
import { TokenService } from "./modules/auth/tokens";

export function buildDeps(env: Env, logger = createLogger(env.LOG_LEVEL)): AppDeps {
  const root = createRootClient({ url: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
  const db = createDb({ url: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
  const redis = createRedis(env.REDIS_URL);
  const tokens = new TokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS);
  return {
    env,
    logger,
    root,
    db,
    redis,
    tokens,
    authState: new AuthStateStore(root, redis, env.ACCESS_TOKEN_TTL_SECONDS),
    readiness: {
      db: async () => {
        await root.$queryRaw`SELECT 1`;
      },
      redis: async () => {
        await redis.ping();
      },
    },
  };
}

export async function closeDeps(deps: AppDeps) {
  await Promise.allSettled([deps.root.$disconnect(), deps.db.$disconnect(), deps.redis.quit()]);
}

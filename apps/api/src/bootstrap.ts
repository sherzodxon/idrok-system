import { createDb, createRootClient } from "@idrok/db";
import type { Env } from "./config/env";
import type { AppDeps } from "./deps";
import { createQueues } from "./infra/queue";
import { createRedis, type RedisClient } from "./infra/redis";
import { noSmsProvider } from "./infra/sms";
import { createStorage } from "./infra/storage";
import { HttpTelegramClient } from "./infra/telegram";
import { configurePasswordHashing } from "./modules/auth/password";
import { createLogger } from "./logger";
import { AuthStateStore } from "./modules/access/auth-state";
import { TokenService } from "./modules/auth/tokens";

/** BullMQ needs maxmemory-policy=noeviction; anything else may silently drop queued jobs. */
export async function assertRedisNoEviction(redis: RedisClient) {
  const info = await redis.info("memory");
  const policy = /maxmemory_policy:(\S+)/.exec(info)?.[1];
  if (policy && policy !== "noeviction") throw new Error(`Redis maxmemory-policy is ${policy}, expected noeviction`);
}

export function buildDeps(env: Env, logger = createLogger(env.LOG_LEVEL)): AppDeps {
  configurePasswordHashing(env.ARGON2_MEMORY_KIB);
  const root = createRootClient({ url: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
  const db = createDb({ url: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
  const redis = createRedis(env.REDIS_URL);
  const tokens = new TokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS);
  const { queues, close: closeQueues } = createQueues(env.REDIS_URL);
  return {
    env,
    logger,
    root,
    db,
    redis,
    tokens,
    storage: createStorage(env),
    queues,
    closeQueues,
    authState: new AuthStateStore(root, redis, env.ACCESS_TOKEN_TTL_SECONDS),
    telegram: new HttpTelegramClient(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_API_URL),
    sms: noSmsProvider,
    readiness: {
      db: async () => {
        await root.$queryRaw`SELECT 1`;
      },
      redis: async () => {
        await redis.ping();
        await assertRedisNoEviction(redis);
      },
    },
  };
}

export async function closeDeps(deps: AppDeps) {
  await Promise.allSettled([deps.closeQueues(), deps.root.$disconnect(), deps.db.$disconnect(), deps.redis.quit()]);
}

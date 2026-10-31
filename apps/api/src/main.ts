import { Redis } from "ioredis";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import type { ReadinessCheck } from "./http/health";
import { createLogger } from "./logger";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);

const readiness: Record<string, ReadinessCheck> = {};
if (env.REDIS_URL) {
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  readiness.redis = async () => {
    if (redis.status === "wait") await redis.connect();
    await redis.ping();
  };
}

const app = createApp({ logger, readiness });
app.listen(env.PORT, () => logger.info({ port: env.PORT }, "api listening"));

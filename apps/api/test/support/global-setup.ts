import type { TestProject } from "vitest/node";
import { startTestDatabase } from "@idrok/db/testing";

export default async function setup(project: TestProject) {
  const db = await startTestDatabase();
  let redisUrl = process.env.TEST_REDIS_URL;
  let stopRedis = async () => {};
  if (!redisUrl) {
    const { RedisMemoryServer } = await import("redis-memory-server");
    const server = await RedisMemoryServer.create();
    redisUrl = `redis://${await server.getHost()}:${await server.getPort()}`;
    stopRedis = async () => {
      await server.stop();
    };
  }
  project.provide("databaseUrl", db.url);
  project.provide("redisUrl", redisUrl);
  return async () => {
    await stopRedis();
    await db.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

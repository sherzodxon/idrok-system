import { describe, expect, it } from "vitest";
import { assertRedisNoEviction } from "../src/bootstrap";
import type { RedisClient } from "../src/infra/redis";

const fake = (policy: string) =>
  ({ info: async () => `# Memory\r\nmaxmemory_policy:${policy}\r\n` }) as unknown as RedisClient;

describe("Redis eviction policy (BullMQ needs noeviction)", () => {
  it("accepts noeviction", async () => {
    await expect(assertRedisNoEviction(fake("noeviction"))).resolves.toBeUndefined();
  });
  it("fails readiness on an evicting policy", async () => {
    await expect(assertRedisNoEviction(fake("allkeys-lru"))).rejects.toThrow(/allkeys-lru/);
  });
});

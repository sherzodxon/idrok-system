// Sliding-window counters in Redis (sorted set of hit timestamps per key).
import { randomUUID } from "node:crypto";
import type { RedisClient } from "./redis";

export interface WindowState {
  count: number;
  /** Seconds until the oldest counted hit leaves the window (0 when the window is empty). */
  retryAfterSec: number;
}

export class SlidingWindow {
  constructor(
    private readonly redis: RedisClient,
    private readonly windowMs: number,
  ) {}

  async state(key: string, now = Date.now()): Promise<WindowState> {
    const results = await this.redis
      .multi()
      .zremrangebyscore(key, "0", String(now - this.windowMs))
      .zcard(key)
      .zrange(key, "0", "0", "WITHSCORES")
      .exec();
    const count = Number(results?.[1]?.[1] ?? 0);
    const oldest = (results?.[2]?.[1] as string[] | undefined)?.[1];
    const retryAfterSec = oldest ? Math.max(1, Math.ceil((Number(oldest) + this.windowMs - now) / 1000)) : 0;
    return { count, retryAfterSec };
  }

  async hit(key: string, now = Date.now()): Promise<void> {
    await this.redis.multi().zadd(key, String(now), `${now}:${randomUUID()}`).pexpire(key, this.windowMs).exec();
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

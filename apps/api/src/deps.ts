import type { Db, RootClient } from "@idrok/db";
import type { Logger } from "pino";
import type { Env } from "./config/env";
import type { ReadinessCheck } from "./http/health";
import type { Queues } from "./infra/queue";
import type { RedisClient } from "./infra/redis";
import type { SmsProvider } from "./infra/sms";
import type { TelegramClient } from "./infra/telegram";
import type { StorageProvider } from "./infra/storage";
import type { AuthStateStore } from "./modules/access/auth-state";
import type { TokenService } from "./modules/auth/tokens";

/** Everything the HTTP app needs; built once in main.ts (or by tests). */
export interface AppDeps {
  env: Env;
  logger: Logger;
  /** Unscoped client: only for pre-auth lookups (login, refresh) and bootstrap. */
  root: RootClient;
  /** Tenant-scoped client for all application queries. */
  db: Db;
  redis: RedisClient;
  tokens: TokenService;
  storage: StorageProvider;
  /** Producers only; jobs normally go through the outbox (infra/outbox.ts). */
  queues: Queues;
  closeQueues: () => Promise<void>;
  authState: AuthStateStore;
  /** M7: outgoing bot messages (worker) — replaced by a fake in tests. */
  telegram: TelegramClient;
  /** M7: SMS fallback; no provider yet (Q-57). */
  sms: SmsProvider;
  readiness: Record<string, ReadinessCheck>;
}

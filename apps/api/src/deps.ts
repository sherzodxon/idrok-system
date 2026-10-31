import type { Db, RootClient } from "@idrok/db";
import type { Logger } from "pino";
import type { Env } from "./config/env";
import type { ReadinessCheck } from "./http/health";
import type { RedisClient } from "./infra/redis";
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
  authState: AuthStateStore;
  readiness: Record<string, ReadinessCheck>;
}

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { tenantExtension } from "./tenant-extension";

export interface DbOptions {
  /** Pooler URL in production (Supabase transaction mode); a direct URL locally and in tests. */
  url: string;
  /** Max connections per process (keep instances × max under the pooler limit). */
  max?: number;
}

/**
 * Unscoped client: no tenant enforcement. Only for bootstrap scripts (seed, creating a tenant) and the tenant
 * extension's own tests. Application code uses createDb().
 */
export function createRootClient(options: DbOptions) {
  const adapter = new PrismaPg({ connectionString: options.url, max: options.max ?? 5 });
  return new PrismaClient({ adapter });
}

/** Tenant-scoped client used by the API and the worker. */
export function createDb(options: DbOptions) {
  return createRootClient(options).$extends(tenantExtension);
}

export type RootClient = ReturnType<typeof createRootClient>;
export type Db = ReturnType<typeof createDb>;
export type DbTransaction = Parameters<Parameters<Db["$transaction"]>[0]>[0];

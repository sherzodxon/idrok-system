// File storage abstraction (architecture.md §9). Files are never served statically: callers stream them through an
// authorised endpoint. Adapters: local disk (dev/tests), Supabase Storage (now), S3 (after the move to a VPS).
import type { Readable } from "node:stream";

export interface PutOptions {
  contentType: string;
}

export interface StorageProvider {
  put(key: string, body: Buffer, opts: PutOptions): Promise<void>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

/** "<tenantId>/<kind>/<uuid>.<ext>" — the only shape of storage keys. */
export const storageKey = (tenantId: string, kind: string, id: string, ext: string) =>
  `${tenantId}/${kind.toLowerCase()}/${id}.${ext.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;

export function assertSafeKey(key: string) {
  if (!/^[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/.test(key))
    throw new Error(`Unsafe storage key: ${key}`);
}

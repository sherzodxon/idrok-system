import type { Env } from "../../config/env";
import { LocalDiskStorage } from "./local-disk";
import type { StorageProvider } from "./storage";
import { SupabaseStorage } from "./supabase";

export * from "./storage";

export function createStorage(env: Env): StorageProvider {
  if (env.STORAGE_DRIVER === "supabase") {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
      throw new Error("Supabase storage needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    return new SupabaseStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_STORAGE_BUCKET);
  }
  return new LocalDiskStorage(env.STORAGE_LOCAL_DIR);
}

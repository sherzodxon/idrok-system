import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),
  REDIS_URL: z.string().url(),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  /** Number of proxies in front of the app (Render: 1). Needed for the client IP used in rate limits. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  /** HS256 signing key for access tokens, at least 32 characters. */
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Parent domain for cookies shared by app.<domain> and api.<domain>; empty = host-only cookies. */
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: bool.default(true),
  /** Tenant used when a login request does not name one (single-school deployment). */
  DEFAULT_TENANT_SLUG: z.string().default("idrok"),
  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".data/storage"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("idrok-files"),
  /** argon2id memory cost in KiB (OWASP minimum 19456). Lower values only in tests. */
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(19_456),
  /** AES-256-GCM key for device passwords and face photos (M6): 32 bytes, base64. Face ID secrets need it. */
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, { message: "must be 32 bytes, base64" })
    .optional(),
  /** Public base URL of the API as terminals and bridges reach it (webhook URLs shown to the admin). */
  DEVICE_PUBLIC_API_URL: z.string().url().optional(),
  /** Optional: errors are POSTed here as short JSON alerts (infra/alerts.ts). Keep it secret if it carries a token. */
  ALERT_WEBHOOK_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Only variable names are reported, never their values.
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return parsed.data;
}

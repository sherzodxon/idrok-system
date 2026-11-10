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
  /** M7: bot token from @BotFather. Never logged (it is part of every Bot API URL). Empty = Telegram off. */
  TELEGRAM_BOT_TOKEN: z
    .string()
    .regex(/^\d+:[A-Za-z0-9_-]{30,}$/, { message: "invalid bot token" })
    .optional(),
  /** M7: secret_token given to setWebhook; Telegram echoes it in X-Telegram-Bot-Api-Secret-Token. */
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32,256}$/, { message: "32-256 characters A-Z a-z 0-9 _ -" })
    .optional(),
  /** Bot username without @ (deep links t.me/<name>?start=<code>). */
  TELEGRAM_BOT_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9_]{5,64}$/)
    .optional(),
  /** Bot API base URL (tests point it at a fake server). */
  TELEGRAM_API_URL: z.string().url().default("https://api.telegram.org"),
  /** Public URL of the Mini App page (the web app's /tg), shown as the bot's button. */
  TELEGRAM_MINI_APP_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Telegram (M7) is on only with both the bot token and the webhook secret; otherwise the whole feature is off. */
export const telegramEnabled = (env: Pick<Env, "TELEGRAM_BOT_TOKEN" | "TELEGRAM_WEBHOOK_SECRET">) =>
  !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET);

/** The bot works only with both the token and the webhook secret. */
const telegramPair = (env: Env) => !!env.TELEGRAM_BOT_TOKEN === !!env.TELEGRAM_WEBHOOK_SECRET;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // An empty value (KEY= in a .env file, or a field left blank in the Render dashboard) means "not set": optional
  // features (alerts, Telegram, Face ID keys) stay off instead of failing their format check.
  const set = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = EnvSchema.safeParse(set);
  if (!parsed.success) {
    // Only variable names are reported, never their values.
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  if (!telegramPair(parsed.data)) {
    throw new Error("Invalid environment configuration: TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET go together");
  }
  return parsed.data;
}

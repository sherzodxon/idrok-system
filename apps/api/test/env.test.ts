// security-baseline.md S3: secrets have no defaults — the server refuses to start without them.
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";

const VALID = {
  DATABASE_URL: "postgresql://u:db-secret-value@localhost:5432/idrok",
  REDIS_URL: "redis://:redis-secret-value@localhost:6379",
  JWT_SECRET: "jwt-secret-value-jwt-secret-value-123456",
};
const SECRETS = Object.keys(VALID) as (keyof typeof VALID)[];

describe("environment", () => {
  it("starts with all secrets present", () => {
    expect(() => loadEnv({ ...VALID })).not.toThrow();
  });

  it.each(SECRETS)("refuses to start without %s", (key) => {
    const env: Record<string, string> = { ...VALID };
    delete env[key];
    expect(() => loadEnv(env)).toThrow(key);
  });

  it("blank optional values (a field left empty in the host's dashboard) mean not set", () => {
    const env = loadEnv({
      ...VALID,
      ALERT_WEBHOOK_URL: "",
      DATA_ENCRYPTION_KEY: " ",
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_WEBHOOK_SECRET: "",
      TELEGRAM_MINI_APP_URL: "",
    });
    expect(env.ALERT_WEBHOOK_URL).toBeUndefined();
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    // A blank required secret is still missing.
    expect(() => loadEnv({ ...VALID, JWT_SECRET: "" })).toThrow("JWT_SECRET");
  });

  it("rejects a short JWT secret", () => {
    expect(() => loadEnv({ ...VALID, JWT_SECRET: "short" })).toThrow("JWT_SECRET");
  });

  it("never echoes secret values in the error", () => {
    try {
      loadEnv({ ...VALID, JWT_SECRET: "short-but-secret", DATABASE_URL: "not a url db-secret-value" });
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain("short-but-secret");
      expect(message).not.toContain("db-secret-value");
    }
  });
});

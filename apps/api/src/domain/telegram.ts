// Pure Telegram helpers (M7): Mini App initData check, link codes, phone and locale normalisation.
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

export interface TelegramWebAppUser {
  id: number;
  firstName: string;
  username: string | null;
  languageCode: string | null;
}

/** initData older than this is refused (a stolen link stops working; T-92). */
export const INIT_DATA_MAX_AGE_SEC = 24 * 3600;

/**
 * Verifies Telegram Mini App initData (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * secret = HMAC_SHA256(key "WebAppData", bot token); hash = hex(HMAC_SHA256(secret, data-check-string)), where the
 * data-check-string is every field except `hash`, sorted by key, as `key=value` joined by "\n".
 * Returns the user, or null for anything forged, stale, from the future or malformed.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  nowSec = Math.floor(Date.now() / 1000),
  maxAgeSec = INIT_DATA_MAX_AGE_SEC,
): { user: TelegramWebAppUser; authDate: number } | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const pairs: [string, string][] = [];
  for (const [k, v] of params) if (k !== "hash") pairs.push([k, v]);
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const checkString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || authDate <= 0) return null;
  if (nowSec - authDate > maxAgeSec || authDate - nowSec > 300) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(params.get("user") ?? "null");
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  if (typeof u.id !== "number" || !Number.isSafeInteger(u.id) || u.id <= 0) return null;
  return {
    authDate,
    user: {
      id: u.id,
      firstName: typeof u.first_name === "string" ? u.first_name : "",
      username: typeof u.username === "string" ? u.username : null,
      languageCode: typeof u.language_code === "string" ? u.language_code : null,
    },
  };
}

/** Signs initData the way Telegram does — for tests and the local e2e stack only. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const pairs = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const checkString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  const params = new URLSearchParams(pairs);
  params.set("hash", hash);
  return params.toString();
}

// No 0/O, 1/I/L: the code may be typed by hand.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 10;

export function newLinkCode(): string {
  let code = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Codes are compared case-insensitively; only this hash is stored. */
export const hashLinkCode = (code: string) =>
  createHash("sha256").update(`tg-link:${code.trim().toUpperCase()}`).digest("hex");

export const looksLikeLinkCode = (value: string) =>
  new RegExp(`^[${CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`).test(value.trim().toUpperCase());

/** Bot and notification language: the guardian's portal choice, else Telegram's ("ru…" → ru), else uz. */
export function botLocale(preferred: string | null | undefined, telegramLanguage: string | null | undefined) {
  if (preferred === "uz" || preferred === "ru") return preferred;
  return telegramLanguage?.toLowerCase().startsWith("ru") ? "ru" : "uz";
}

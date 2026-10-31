import { pino, type Logger } from "pino";

/** Secrets and personal data never reach the logs (CLAUDE.md §4). */
export const REDACT_PATHS = [
  "password",
  "*.password",
  "*.newPassword",
  "*.currentPassword",
  "token",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "apiKey",
  "*.apiKey",
];

export function createLogger(level: string): Logger {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: "[redacted]" } });
}

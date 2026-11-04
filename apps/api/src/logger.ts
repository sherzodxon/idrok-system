import { pino, type DestinationStream, type Logger } from "pino";

// Secrets never reach the logs (CLAUDE.md §4, security-baseline.md S3). Field names are redacted at the top level and
// one level deep (`*.x`); request headers explicitly.
const SECRET_FIELDS = [
  "password",
  "newPassword",
  "currentPassword",
  "temporaryPassword",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "apiKey",
  "secret",
];

export const REDACT_PATHS = [
  ...SECRET_FIELDS,
  ...SECRET_FIELDS.map((f) => `*.${f}`),
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
];

export const REDACTED = "[Redacted]";

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: REDACTED } }, destination);
}

/** Path segments that are credentials (device webhook keys) are replaced before a URL is logged. */
export function maskUrlSecrets(url: string | undefined): string | undefined {
  return url?.replace(/(\/hikvision-event\/)[^/?#]+/, `$1${REDACTED}`);
}

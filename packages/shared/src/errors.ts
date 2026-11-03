// Machine-readable API error codes. The API answers { error: { code, message, details? } } where `message` is the
// translation key for `code` (CLAUDE.md §5).

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "AUTH_REQUIRED",
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_TOKEN_EXPIRED",
  "AUTH_SESSION_REVOKED",
  "AUTH_RATE_LIMITED",
  "CSRF_TOKEN_INVALID",
  "PASSWORD_CHANGE_REQUIRED",
  "PASSWORD_TOO_WEAK",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "SCORE_LIMIT_EXCEEDED",
  "COIN_LIMIT_EXCEEDED",
  "COIN_INSUFFICIENT_BALANCE",
  "RATE_LIMITED",
  "TENANT_CONTEXT_MISSING",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** "AUTH_INVALID_CREDENTIALS" → "errors.AUTH_INVALID_CREDENTIALS". */
export function errorMessageKey(code: ErrorCode): string {
  return `errors.${code}`;
}

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

// Default-deny (security-baseline.md S1). Every route needs authentication AND a permission, except the ones listed
// here. defineRoute refuses to register a route whose access rule is not backed by this file, and
// test/route-guard.test.ts checks every route Express actually serves. Paths are relative to /api/v1.

/** Reachable without a token. */
export const PUBLIC_ROUTES = [
  "GET /healthz",
  "GET /readyz",
  "POST /auth/login",
  "POST /auth/refresh",
  // School name and colours for the login page; no personal data.
  "GET /branding",
  // M6: Face ID terminal push. No user token: the device is identified by the key in the path (only its hash is
  // stored), the tenant comes from that device; unknown keys are rate limited (attendance/webhook.routes.ts).
  "POST /attendance/hikvision-event/:key",
  // M6: the bridge agent's protocol. No user token: the bridge's bearer token (hash lookup) identifies it and its
  // tenant; bad tokens are rate limited (attendance/bridge.routes.ts).
  "POST /bridge/heartbeat",
  "POST /bridge/jobs/lease",
  "GET /bridge/jobs/:id/photo",
  "POST /bridge/jobs/:id/result",
  "POST /bridge/events",
  "POST /bridge/token/rotate",
  // M7: Telegram bot webhook. No user token: the X-Telegram-Bot-Api-Secret-Token header must match
  // TELEGRAM_WEBHOOK_SECRET (timing-safe); the tenant is the deployment's school (T-89, T-90).
  "POST /telegram/webhook",
  // M7: Mini App login. initData is verified with the bot token (HMAC), rate limited per IP (T-92).
  "POST /auth/telegram",
] as const;

/** Any logged-in user, no permission: the user's own account and session only. */
export const SELF_SERVICE_ROUTES = [
  "GET /me",
  "PATCH /me/preferences",
  "POST /auth/logout",
  "POST /auth/logout-all",
  "GET /auth/sessions",
  "DELETE /auth/sessions/:id",
  "POST /auth/change-password",
  "GET /openapi.json",
] as const;

export const routeId = (method: string, path: string) => `${method.toUpperCase()} ${path}`;

const publicSet = new Set<string>(PUBLIC_ROUTES);
const selfServiceSet = new Set<string>(SELF_SERVICE_ROUTES);
export const isPublicRoute = (id: string) => publicSet.has(id);
export const isSelfServiceRoute = (id: string) => selfServiceSet.has(id);

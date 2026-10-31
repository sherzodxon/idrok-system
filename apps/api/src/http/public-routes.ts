// Default-deny (security-baseline.md S1). Every route needs authentication AND a permission, except the ones listed
// here. defineRoute refuses to register a route whose access rule is not backed by this file, and
// test/route-guard.test.ts checks every route Express actually serves. Paths are relative to /api/v1.

/** Reachable without a token. */
export const PUBLIC_ROUTES = ["GET /healthz", "GET /readyz", "POST /auth/login", "POST /auth/refresh"] as const;

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

// Browser API client: cookie auth + CSRF double-submit, one refresh attempt on an expired access token, typed errors.
import type { ApiErrorBody, ErrorCode } from "@idrok/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "NETWORK",
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export interface ApiClientDeps {
  baseUrl: string;
  fetch: typeof fetch;
  readCookie: (name: string) => string | undefined;
  /** Called when the session cannot be refreshed (go to the login page). */
  onSessionLost: () => void;
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REFRESHABLE: readonly string[] = ["AUTH_TOKEN_EXPIRED", "AUTH_REQUIRED"];

export function createApiClient(deps: ApiClientDeps) {
  let refreshing: Promise<boolean> | null = null;

  async function send(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { Accept: "application/json", ...extraHeaders };
    if (body !== undefined && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    const csrf = deps.readCookie("idrok_csrf");
    if (UNSAFE.has(method) && csrf) headers["X-CSRF-Token"] = csrf;
    try {
      return await deps.fetch(`${deps.baseUrl}${path}`, {
        method,
        headers,
        credentials: "include",
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "NETWORK");
    }
  }

  /** Single-flight: parallel 401s share one refresh request. */
  function refresh(): Promise<boolean> {
    refreshing ??= send("POST", "/auth/refresh", {})
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function toError(res: Response): Promise<ApiError> {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    return new ApiError(res.status, body?.error?.code ?? "INTERNAL_ERROR", body?.error?.details);
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    let res = await send(method, path, body, headers);
    if (res.status === 401 && path !== "/auth/login" && path !== "/auth/refresh") {
      const err = await toError(res);
      if (REFRESHABLE.includes(err.code) && (await refresh())) {
        res = await send(method, path, body, headers);
      } else {
        deps.onSessionLost();
        throw err;
      }
      if (res.status === 401) {
        deps.onSessionLost();
        throw await toError(res);
      }
    }
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body: unknown = {}, headers?: Record<string, string>) =>
      request<T>("POST", path, body, headers),
    put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
    delete: <T>(path: string) => request<T>("DELETE", path),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function readBrowserCookie(name: string): string | undefined {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

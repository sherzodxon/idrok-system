// Content-Security-Policy for every page (implementation-plan step 8). Scripts run only with the per-request nonce
// (Next.js adds it to its own scripts); the browser may talk to this origin and the API only.

export interface CspOptions {
  nonce: string;
  /** API base URL as the browser sees it (API_PUBLIC_URL). */
  apiUrl: string;
  /** `next dev` needs eval for React's debugging features. */
  dev?: boolean;
  /** M7: the Mini App pages may be framed by Telegram Web (web.telegram.org); every other page cannot be framed. */
  telegramFrame?: boolean;
}

export function buildCsp({ nonce, apiUrl, dev = false, telegramFrame = false }: CspOptions): string {
  const api = new URL(apiUrl).origin;
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Brand colours are set as inline CSS variables; styles cannot run code.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", api],
    "font-src": ["'self'"],
    "connect-src": ["'self'", api],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": telegramFrame ? ["'self'", "https://web.telegram.org"] : ["'none'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!dev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** 128 random bits, base64. */
export function createNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

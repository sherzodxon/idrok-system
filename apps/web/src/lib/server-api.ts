// Server-side only: the web server reads public data from the API (branding for CSS variables and the login page).
import "server-only";
import type { Branding } from "@idrok/shared";

/** URL the browser uses (runtime, so one build serves every environment). */
export const apiPublicUrl = () => process.env.API_PUBLIC_URL ?? "http://localhost:4000/api/v1";
/** URL the web server uses inside the private network (falls back to the public one). */
const apiInternalUrl = () => process.env.API_INTERNAL_URL ?? apiPublicUrl();

export async function getBranding(): Promise<Branding | null> {
  try {
    const tenant = process.env.TENANT_SLUG ? `?tenant=${encodeURIComponent(process.env.TENANT_SLUG)}` : "";
    const res = await fetch(`${apiInternalUrl()}/branding${tenant}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? ((await res.json()) as Branding) : null;
  } catch {
    // The login page still renders with the default tokens if the API is unreachable.
    return null;
  }
}

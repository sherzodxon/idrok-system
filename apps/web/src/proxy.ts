// Next.js proxy (formerly middleware): pages need a session. The CSRF cookie (path /, lives as long as the refresh
// token) is the signal; the API still authenticates every request — this only avoids rendering a page to bounce.
// Every page also gets a nonce-based Content-Security-Policy.
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, createNonce } from "./lib/csp";
import { apiPublicUrl } from "./lib/server-api";

const PUBLIC_PAGES = ["/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !request.cookies.has("idrok_csrf")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const nonce = createNonce();
  const csp = buildCsp({ nonce, apiUrl: apiPublicUrl(), dev: process.env.NODE_ENV === "development" });
  // Next.js reads the nonce from the request's CSP header and puts it on the scripts it renders.
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = { matcher: ["/((?!_next/|favicon.ico|.*\\.[a-z0-9]+$).*)"] };

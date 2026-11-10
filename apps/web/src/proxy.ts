// Next.js proxy (formerly middleware): pages need a session. The CSRF cookie (path /, lives as long as the refresh
// token) is the signal; the API still authenticates every request — this only avoids rendering a page to bounce.
// Every page also gets a nonce-based Content-Security-Policy.
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, createNonce } from "./lib/csp";
import { apiPublicUrl } from "./lib/server-api";
import { TELEGRAM_MARKER_COOKIE } from "./lib/telegram";

// /tg is the Telegram Mini App entry: it signs in with Telegram's initData (no cookie session yet).
const PUBLIC_PAGES = ["/login", "/tg"];
// The Mini App's own pages: the entry and the portal it opens (framed by Telegram Web).
const PORTAL_PAGES = ["/tg", "/home", "/schedule", "/progress", "/attendance", "/coins", "/tests", "/me"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // A Telegram tab authenticates with bearer tokens; its marker cookie only lets the page render (the API checks).
  const telegram = request.cookies.has(TELEGRAM_MARKER_COOKIE);
  if (!isPublic && !request.cookies.has("idrok_csrf") && !telegram) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const nonce = createNonce();
  const portalPage = PORTAL_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const csp = buildCsp({
    nonce,
    apiUrl: apiPublicUrl(),
    dev: process.env.NODE_ENV === "development",
    telegramFrame: portalPage && (telegram || pathname === "/tg"),
  });
  // Next.js reads the nonce from the request's CSP header and puts it on the scripts it renders.
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = { matcher: ["/((?!_next/|favicon.ico|.*\\.[a-z0-9]+$).*)"] };

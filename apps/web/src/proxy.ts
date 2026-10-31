// Next.js proxy (formerly middleware): pages need a session. The CSRF cookie (path /, lives as long as the refresh
// token) is the signal; the API still authenticates every request — this only avoids rendering a page to bounce.
import { NextResponse, type NextRequest } from "next/server";

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
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|favicon.ico|.*\\.[a-z0-9]+$).*)"] };

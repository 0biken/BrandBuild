import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/api/session";

/**
 * Optimistic auth check: signed-out visitors to the app are sent to log in,
 * with the page they wanted kept in ?next=. This only checks the cookie
 * exists; the API still authorises every request.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

// Must be literal: Next reads the matcher statically at build time.
// Keep in sync with APP_HOME.
export const config = {
  matcher: ["/app", "/app/:path*"],
};

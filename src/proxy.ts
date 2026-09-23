import { NextResponse, type NextRequest } from "next/server";

/**
 * An optimistic first gate: pages need a session cookie at all, or the visitor
 * goes to /login before any page code runs. It only checks the cookie exists —
 * real authorisation (valid session, role, business access) happens in the
 * server layer (src/server/session.ts, access.ts) on every page and route.
 */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasSession) {
    const login = new URL("/login", request.url);
    const back = request.nextUrl.pathname + request.nextUrl.search;
    if (back !== "/") login.searchParams.set("next", back);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the signed-out pages (sign-in, password reset), API
  // routes (which answer 401 themselves), and static assets.
  matcher: ["/((?!login|forgot-password|reset-password|api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};

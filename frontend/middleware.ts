import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Route protection — spec §6: everything except /sign-in needs a session.
 *
 * The backend sets its session cookie on `localhost`, and cookies ignore port,
 * so the cookie set by :8000 is visible here on :3000. This only checks the
 * cookie is present; the API still validates the JWT on every request, so a
 * forged or expired cookie gets a 401 from the backend regardless.
 */
const COOKIE_NAME = "oink_session";

/** Signed out only: a signed-in visitor gets sent to the feed instead. */
const PUBLIC_PATHS = ["/sign-in"];

/**
 * Open either way, and gated neither way.
 *
 * These are reached from a link in an email, so they have to work for somebody
 * with no session — the person resetting a password is by definition locked
 * out. They also have to work for somebody *with* one, or confirming your
 * address while already signed in bounces you to the feed without confirming
 * anything. The tokens are the authentication here, and the API checks them.
 */
const OPEN_PATHS = ["/reset-password", "/verify-email"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(COOKIE_NAME);
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (OPEN_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Vercel services can't host Edge Functions, and middleware defaults to the
  // Edge runtime. This gate needs no Edge-specific behaviour, so run it on Node.
  runtime: "nodejs",
  // Static files are exempt, not just the ones under _next.
  //
  // This gate used to catch /icon-192.png and /manifest.webmanifest and answer
  // both with a 307 to /sign-in. Adding the app to a home screen is exactly the
  // case that breaks on: the OS fetches the icon and the manifest itself, in a
  // context that carries no session cookie, so it got HTML where it wanted a
  // PNG and fell back to a screenshot of the page. Nothing in public/ is
  // private, and none of it is worth gating.
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|webmanifest|txt|xml)$).*)",
  ],
};

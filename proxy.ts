import { getDb } from "./db";
import { findSessionIdentity, findSessionUser } from "./auth/session-store";
import { safeLegalDestination } from "./legal/destination";
import { hasLocale } from "next-intl";
import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const negotiateLocale = createMiddleware(routing);

export default async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const language = /^\/(en|es)(?:\/|$)/.exec(path)?.[1];
  const allowed =
    /^\/(en|es)\/(legal(?:\/|$)|accept-legal(?:\/|$)|confirm-email(?:\/|$)|reset-password(?:\/|$))/.test(
      path,
    );
  // Service boundaries independently authorize every mutation and private read.
  // Let POST reach those boundaries, including logout and purpose-bound links.
  const token = request.cookies.get("track_atlas_session")?.value;
  if (
    language &&
    token &&
    !allowed &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    const identity = await findSessionIdentity(getDb(), token);
    if (identity && !(await findSessionUser(getDb(), token))) {
      const target = new URL(`/${language}/accept-legal`, request.url);
      target.searchParams.set(
        "returnTo",
        safeLegalDestination(path + request.nextUrl.search, language),
      );
      const response = NextResponse.redirect(target);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  }
  const segment = request.nextUrl.pathname.split("/")[1];
  // Let the locale layout reject unsupported language prefixes with a 404,
  // rather than redirecting /fr to /en/fr.
  if (
    /^[a-z]{2}(?:-[a-zA-Z]{2})?$/.test(segment) &&
    !hasLocale(routing.locales, segment)
  ) {
    return NextResponse.next();
  }
  const response = negotiateLocale(request);
  if (
    /^\/(en|es)\/(?:accept-legal\/?|admin(?:\/.*)?|confirm-email\/?|reset-password\/?|(?:tracks|lists)(?:\/[^/]+)?\/?|users\/[^/]+\/tracks\/?)$/.test(
      request.nextUrl.pathname,
    )
  ) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};

import { hasLocale } from "next-intl";
import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const negotiateLocale = createMiddleware(routing);

export default function proxy(request: NextRequest) {
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
    /^\/(en|es)\/(?:confirm-email\/?|reset-password\/?|(?:tracks|lists)(?:\/[^/]+)?\/?|users\/[^/]+\/tracks\/?)$/.test(
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

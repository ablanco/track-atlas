import { getPublicTrack } from "./tracks/public";
import { indexingEnabled } from "./seo/config";
import { getDb } from "./db";
import { findSessionIdentity, findSessionUser } from "./auth/session-store";
import { safeLegalDestination } from "./legal/destination";
import { hasLocale } from "next-intl";
import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { normalizeAcceptLanguage } from "./i18n/locales";

const negotiateLocale = createMiddleware(routing);

export default async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segment = path.split("/")[1];
  const language = hasLocale(routing.locales, segment) ? segment : undefined;
  const localizedPath = language ? path.slice(language.length + 1) || "/" : "";
  const allowed =
    /^\/(legal(?:\/|$)|accept-legal(?:\/|$)|confirm-email(?:\/|$)|reset-password(?:\/|$))/.test(
      localizedPath,
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
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
      return response;
    }
  }
  // Let the locale layout reject unsupported language prefixes with a 404,
  // rather than redirecting /nl to /en/nl.
  if (
    /^[a-z]{2}(?:-[a-zA-Z]{2})?$/.test(segment) &&
    !hasLocale(routing.locales, segment)
  ) {
    const response = NextResponse.next();
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }
  // Keep regional browser preferences aligned with our language-only routes.
  // Cookie and explicit route precedence remain next-intl's responsibility.
  const preferredLanguages = request.headers.get("accept-language");
  if (preferredLanguages)
    request.headers.set(
      "accept-language",
      normalizeAcceptLanguage(preferredLanguages),
    );
  const response = negotiateLocale(request);
  const rewrite = response.headers.get("x-middleware-rewrite");
  if (language && /^\/admin(?:\/|$)/.test(localizedPath) && rewrite) {
    const destination = new URL(rewrite);
    const source = new URL(request.url);
    // next-intl decodes JSON ID brackets, producing a rewrite to the same route.
    // Next.js normalizes loopback hosts to localhost and can mistake that rewrite
    // for an external HTTPS upstream when the server binds to 127.0.0.1.
    // Keep the locale request headers/cookie, but let the original URL route directly.
    if (
      destination.origin === source.origin &&
      decodeURI(destination.pathname) === decodeURI(source.pathname) &&
      destination.search === source.search
    ) {
      response.headers.delete("x-middleware-rewrite");
      response.headers.set("x-middleware-next", "1");
    }
  }
  if (
    /^\/(?:accept-legal\/?|admin(?:\/.*)?|confirm-email\/?|reset-password\/?|(?:tracks|lists)(?:\/[^/]+)?\/?|users\/[^/]+\/tracks\/?)$/.test(
      localizedPath,
    )
  ) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  }
  const homepage = localizedPath === "/";
  const detailId = /^\/tracks\/([^/]+)\/?$/.exec(localizedPath)?.[1];
  let publicDetail = false;
  if (indexingEnabled() && detailId) {
    try {
      publicDetail = !!(await getPublicTrack(getDb(), detailId));
    } catch {
      /* Exclude on authority failure. */
    }
  }
  // Eligible pages decide their own robots metadata after all content loads.
  // An affirmative header here could contradict a later unavailable response.
  const eligible =
    indexingEnabled() && (homepage || publicDetail) && !request.nextUrl.search;
  if (!eligible) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};

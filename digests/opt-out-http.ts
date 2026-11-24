import "server-only";
import type { Database } from "../auth/database";
import type { SupportedLocale } from "../i18n/locales";
import { consumeDigestOptOut, isDigestToken } from "./opt-out";
import { digestCopy, escapeHtml as escape } from "./render";
const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
export async function handleDigestOptOut(
  request: Request,
  deps: {
    db: Pick<Database, "execute" | "transaction">;
    origin: string;
    locale: SupportedLocale;
  },
) {
  const { locale } = deps,
    copy = digestCopy(locale).DigestOptOut;
  const page = (status: number, body: string) =>
    new Response(
      `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>${escape(copy.title)}</title><style>:root{color-scheme:light dark;--background:light-dark(#fff,#171717);--foreground:light-dark(#171717,#fafafa);--border:light-dark(#737373,#a3a3a3)}body{background:var(--background);color:var(--foreground);font:1rem/1.6 system-ui;margin:0;padding:2rem}main{max-width:40rem;margin:4rem auto}a{color:inherit}button{font:inherit;color:inherit;background:var(--background);border:2px solid var(--border);border-radius:.4rem;padding:.6rem 1rem;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid currentColor;outline-offset:4px}</style></head><body><main><p>TRACK ATLAS</p><h1>${escape(copy.title)}</h1>${body}<p><a href="/${locale}/settings">${escape(copy.settings)}</a></p></main></body></html>`,
      { status, headers },
    );
  const invalid = () =>
    page(200, `<p role="status">${escape(copy.invalid)}</p>`);
  const url = new URL(request.url);
  if (request.method === "GET") {
    const token = url.searchParams.get("token");
    if (
      [...url.searchParams.keys()].some((k) => k !== "token") ||
      url.searchParams.getAll("token").length !== 1 ||
      !isDigestToken(token)
    )
      return invalid();
    return page(
      200,
      `<p>${escape(copy.question)}</p><form method="post" action="/${locale}/digest-opt-out"><input type="hidden" name="token" value="${escape(token)}"><button type="submit">${escape(copy.confirm)}</button></form>`,
    );
  }
  if (request.method !== "POST")
    return new Response(null, {
      status: 405,
      headers: { ...headers, Allow: "GET, POST" },
    });
  if (url.search) return page(400, "");
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  // A no-referrer document makes Chromium serialize native form Origin as null.
  // Accept that browser case only with same-origin Fetch Metadata, navigation
  // mode and a Host matching trusted configuration; opaque/cross-site forms fail.
  const privateForm =
    origin === "null" &&
    site === "same-origin" &&
    request.headers.get("sec-fetch-mode") === "navigate" &&
    request.headers.get("host") === new URL(deps.origin).host;
  if ((origin !== deps.origin && !privateForm) || site === "cross-site")
    return page(403, "");
  if (
    !/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(
      request.headers.get("content-type") ?? "",
    ) ||
    !["", "identity"].includes(request.headers.get("content-encoding") ?? "")
  )
    return page(400, "");
  try {
    const reader = request.body?.getReader();
    if (!reader) return page(400, "");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.length;
        if (size > 1024) {
          await reader.cancel();
          return page(413, "");
        }
        chunks.push(r.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    if (/%(?![a-f0-9]{2})/i.test(body)) return page(400, "");
    const form = new URLSearchParams(body),
      token = form.get("token");
    if (
      [...form.keys()].some((k) => k !== "token") ||
      form.getAll("token").length !== 1 ||
      !isDigestToken(token)
    )
      return page(400, "");
    return (await consumeDigestOptOut(deps.db, token))
      ? page(200, `<p role="status">${escape(copy.done)}</p>`)
      : invalid();
  } catch {
    return page(503, "");
  }
}

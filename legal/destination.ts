/** Only localized application paths, never account tokens, APIs or renewal loops. */
export function safeLegalDestination(value: unknown, locale: string): string {
  const fallback = locale === "es" ? "/es" : "/en";
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\\\u0000-\u0020\u007f]|%/i.test(value.split("?")[0])
  )
    return fallback;
  try {
    const url = new URL(value, "https://local.invalid");
    if (
      !value.startsWith("/") ||
      value.startsWith("//") ||
      url.origin !== "https://local.invalid" ||
      !/^\/(en|es)(?:\/|$)/.test(url.pathname) ||
      /\/(accept-legal|confirm-email|reset-password)(?:\/|$)/.test(url.pathname)
    )
      return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

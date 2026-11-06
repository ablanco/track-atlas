export const locales = ["en", "es", "fr", "pt", "de", "it"] as const;
export type SupportedLocale = (typeof locales)[number];

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return (
    typeof value === "string" && locales.some((locale) => locale === value)
  );
}

export function localizedAlternates(path: string, origin = "") {
  return Object.fromEntries(
    locales.map((locale) => [locale, `${origin}/${locale}${path}`]),
  );
}

/** Site translations use language-only routes, including European Portuguese. */
export function normalizeAcceptLanguage(value: string): string {
  return value
    .split(",")
    .map((preference) =>
      preference.replace(
        /^(\s*)([a-z]{2})(?:-[a-z0-9]{2,8})+(?=\s*(?:;|$))/i,
        (match, space: string, language: string) =>
          isSupportedLocale(language.toLowerCase())
            ? space + language.toLowerCase()
            : match,
      ),
    )
    .join(",");
}

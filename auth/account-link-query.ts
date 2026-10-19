// Safe for the language switcher's client bundle: no database or crypto access.
export function readAccountLinkToken(
  query: Record<string, string | string[] | undefined>,
): string | null {
  const token = query.token;
  return typeof token === "string" &&
    /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(token)
    ? token
    : null;
}

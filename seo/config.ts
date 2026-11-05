import "server-only";

/** Only an exact deployment opt-in enables discovery. Never infer it from NODE_ENV. */
export function indexingEnabled() {
  return process.env.SEO_INDEXING_ENABLED === "true";
}
export function appOrigin() {
  const production = process.env.NODE_ENV === "production";
  const url = new URL(
    process.env.APP_ORIGIN ?? (production ? "" : "http://localhost:3000"),
  );
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        !production &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw Error("Invalid application origin");
  return url.origin;
}
export const noIndex = { index: false, follow: false };

import type { RequestParameters } from "maplibre-gl";

const mapboxOrigins = new Set([
  "https://api.mapbox.com",
  "https://a.tiles.mapbox.com",
  "https://b.tiles.mapbox.com",
]);

/** Restricted Mapbox tokens need the site origin, never a track URL or query. */
export function mapRequest(url: string): RequestParameters {
  let origin: string | undefined;
  try {
    origin = new URL(url).origin;
  } catch {
    // Relative or malformed URLs retain the default privacy policy.
  }
  return {
    url,
    referrerPolicy:
      origin && mapboxOrigins.has(origin) ? "origin" : "no-referrer",
  };
}

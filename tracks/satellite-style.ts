import type { StyleSpecification } from "maplibre-gl";

/** TileJSON retains Mapbox's provider attribution and native zoom bounds. */
export function createSatelliteStyle(token: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        url: `https://api.mapbox.com/v4/mapbox.satellite.json?secure=true&access_token=${encodeURIComponent(token)}`,
        tileSize: 256,
      },
    },
    layers: [{ id: "satellite", type: "raster", source: "satellite" }],
  };
}

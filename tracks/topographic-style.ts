import type { StyleSpecification } from "maplibre-gl";

/** Restored OpenTopoMap raster basemap; independent of recorded GPX data. */
export const topographicStyle: StyleSpecification = {
  version: 8,
  sources: {
    topographic: {
      type: "raster",
      tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 1,
      maxzoom: 17,
      attribution:
        'Map data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | DEM: <a href="https://viewfinderpanoramas.org/">SRTM</a>, <a href="https://sonny.4lima.de/">Sonny</a> | Map style: © <a href="https://opentopomap.org/">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>)',
    },
  },
  layers: [{ id: "topographic", type: "raster", source: "topographic" }],
};

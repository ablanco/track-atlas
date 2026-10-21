import type {
  ExpressionSpecification,
  LineLayerSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";

// An independent style over OpenFreeMap's published OpenMapTiles-compatible
// schema, not a fetched/mutated copy of Liberty. No sprites, DEM or raster tiles.
// Fields/layers: https://tiles.openfreemap.org/planet
// Lower style zooms cannot reveal features omitted from the provider's tiles.
const source = "outdoor";
function transportLine(
  id: string,
  classes: string[],
  color: string,
  width: number,
  minzoom: number,
  dash?: number[],
): LineLayerSpecification {
  return {
    id,
    type: "line",
    source,
    "source-layer": "transportation",
    minzoom,
    filter: ["match", ["get", "class"], classes, true, false],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": color,
      ...(dash ? { "line-dasharray": dash } : {}),
      "line-width": [
        "interpolate",
        ["exponential", 1.2],
        ["zoom"],
        8,
        width * 0.2,
        12,
        width,
        16,
        width * 2,
        20,
        width * 4,
      ],
      "line-opacity": ["case", ["==", ["get", "brunnel"], "tunnel"], 0.45, 1],
    },
  };
}

/** Outdoor is a presentation choice, never a source of recorded elevations. */
export function createOutdoorStyle(locale: string): StyleSpecification {
  const font = ["Noto Sans Regular"];
  const name: ExpressionSpecification = [
    "coalesce",
    ["get", locale === "es" ? "name:es" : "name:en"],
    ["get", "name"],
    ["get", "name:latin"],
    "",
  ];
  const labelPaint: SymbolLayerSpecification["paint"] = {
    "text-color": "#394638",
    "text-halo-color": "#faf8ed",
    "text-halo-width": 1.5,
  };
  return {
    version: 8,
    name: "Track Atlas Outdoor",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      [source]: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    },
    layers: [
      {
        id: "outdoor-background",
        type: "background",
        paint: { "background-color": "#f4f0e4" },
      },
      {
        id: "outdoor-landuse",
        type: "fill",
        source,
        "source-layer": "landuse",
        paint: {
          "fill-color": [
            "match",
            ["get", "class"],
            ["residential", "commercial", "industrial"],
            "#e9e6df",
            ["farmland", "farm", "orchard", "vineyard"],
            "#eeead2",
            "#f0eddf",
          ],
          "fill-opacity": 0.7,
        },
      },
      {
        id: "outdoor-parks",
        type: "fill",
        source,
        "source-layer": "park",
        paint: { "fill-color": "#e1eacd", "fill-opacity": 0.5 },
      },
      {
        id: "outdoor-landcover",
        type: "fill",
        source,
        "source-layer": "landcover",
        paint: {
          "fill-color": [
            "match",
            ["get", "class"],
            "wood",
            "#c9dcb5",
            "grass",
            "#e1e8c6",
            "wetland",
            "#c9ded2",
            "ice",
            "#f4f9fa",
            "sand",
            "#efe0b8",
            "#ede9db",
          ],
        },
      },
      {
        id: "outdoor-park-boundaries",
        type: "line",
        source,
        "source-layer": "park",
        minzoom: 8,
        paint: {
          "line-color": "#7c9363",
          "line-width": 1,
          "line-dasharray": [4, 3],
          "line-opacity": 0.7,
        },
      },
      {
        id: "outdoor-water",
        type: "fill",
        source,
        "source-layer": "water",
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        paint: { "fill-color": "#a9cede" },
      },
      {
        id: "outdoor-waterways",
        type: "line",
        source,
        "source-layer": "waterway",
        minzoom: 8,
        paint: {
          "line-color": "#81afc5",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 16, 2],
        },
      },
      {
        id: "outdoor-buildings",
        type: "fill",
        source,
        "source-layer": "building",
        minzoom: 15,
        paint: { "fill-color": "#d9d4c9", "fill-opacity": 0.65 },
      },
      transportLine(
        "outdoor-major-roads",
        ["motorway", "trunk", "primary"],
        "#c4b9a8",
        1.6,
        5,
      ),
      transportLine(
        "outdoor-secondary-roads",
        ["secondary", "tertiary"],
        "#c7bfb1",
        1.2,
        8,
      ),
      transportLine(
        "outdoor-minor-roads",
        ["minor", "service", "pedestrian"],
        "#c6c1b7",
        0.8,
        12,
      ),
      transportLine("outdoor-track-casing", ["track"], "#faf8ed", 2.4, 11),
      transportLine("outdoor-tracks", ["track"], "#927047", 1.3, 11, [4, 1.5]),
      transportLine("outdoor-path-casing", ["path"], "#faf8ed", 2, 11),
      transportLine("outdoor-paths", ["path"], "#805532", 1.1, 11, [1.5, 1.5]),
      // Text-only outdoor labels avoid a remote sprite/icon dependency. Do not
      // infer access rights, hiking-route membership or difficulty from linework.
      {
        id: "outdoor-peaks",
        type: "symbol",
        source,
        "source-layer": "mountain_peak",
        minzoom: 10,
        layout: {
          "text-field": [
            "case",
            ["all", ["has", "ele"], ["!=", ["get", "ele"], null]],
            ["concat", name, "\n", ["to-string", ["get", "ele"]], " m"],
            name,
          ],
          "text-font": font,
          "text-size": 12,
          "text-max-width": 9,
        },
        paint: { ...labelPaint, "text-color": "#68513f" },
      },
      {
        id: "outdoor-park-names",
        type: "symbol",
        source,
        "source-layer": "park",
        minzoom: 10,
        layout: {
          "text-field": name,
          "text-font": font,
          "text-size": 12,
          "text-max-width": 12,
        },
        paint: { ...labelPaint, "text-color": "#4d673b" },
      },
      {
        id: "outdoor-places",
        type: "symbol",
        source,
        "source-layer": "place",
        minzoom: 4,
        filter: [
          "match",
          ["get", "class"],
          ["city", "town", "village", "hamlet", "suburb", "isolated_dwelling"],
          true,
          false,
        ],
        layout: {
          "text-field": name,
          "text-font": font,
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 14, 15],
          "symbol-sort-key": ["coalesce", ["get", "rank"], 100],
        },
        paint: labelPaint,
      },
      {
        id: "outdoor-pois",
        type: "symbol",
        source,
        "source-layer": "poi",
        minzoom: 13,
        filter: [
          "match",
          ["get", "subclass"],
          [
            "alpine_hut",
            "wilderness_hut",
            "shelter",
            "drinking_water",
            "spring",
            "camp_site",
            "viewpoint",
            "picnic_site",
          ],
          true,
          false,
        ],
        layout: {
          "text-field": name,
          "text-font": font,
          "text-size": 11,
          "text-max-width": 10,
        },
        paint: labelPaint,
      },
      {
        id: "outdoor-path-names",
        type: "symbol",
        source,
        "source-layer": "transportation_name",
        minzoom: 13,
        filter: ["match", ["get", "class"], ["path", "track"], true, false],
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 300,
          "text-field": name,
          "text-font": font,
          "text-size": 12,
        },
        paint: { ...labelPaint, "text-color": "#725134" },
      },
      {
        id: "outdoor-road-names",
        type: "symbol",
        source,
        "source-layer": "transportation_name",
        minzoom: 14,
        filter: [
          "match",
          ["get", "class"],
          ["minor", "primary", "secondary", "tertiary", "service"],
          true,
          false,
        ],
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 500,
          "text-field": name,
          "text-font": font,
          "text-size": 10,
        },
        paint: { ...labelPaint, "text-color": "#777467" },
      },
      {
        id: "outdoor-water-names",
        type: "symbol",
        source,
        "source-layer": "water_name",
        minzoom: 10,
        layout: { "text-field": name, "text-font": font, "text-size": 12 },
        paint: { ...labelPaint, "text-color": "#3b6c83" },
      },
    ],
  };
}

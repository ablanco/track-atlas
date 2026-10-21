# Synthetic Outdoor map tile

`outdoor.pbf` is an invented Mapbox Vector Tile, extent 4096, encoded using
`@maplibre/vt-pbf` 4.3.2 (the renderer's installed encoder). It contains no
OpenStreetMap/provider-derived data or real recorded positions.

The tile includes wood/grass polygons, a stream, footpath, unpaved track, minor
road, path name, peak with elevation, village and named alpine hut. Layer names
match the OpenFreeMap TileJSON schema. Empty layers represent other style inputs.
Tests serve this tile at every requested fixture coordinate: it is a deterministic
rendering scene, not a geographic coverage or provider-freshness test.

Font requests are stubbed with empty protobuf glyph sets in deterministic tests;
label expressions are checked separately with MapLibre's expression evaluator.
The opt-in live-provider test checks real vector tiles and hosted glyph loading.

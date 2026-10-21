import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { topographicStyle } from "../../tracks/topographic-style";

test("Topographic restores the attributed OpenTopoMap raster source and native zoom bounds", () => {
  assert.deepEqual(validateStyleMin(topographicStyle), []);
  assert.deepEqual(Object.keys(topographicStyle.sources), ["topographic"]);
  const source = topographicStyle.sources.topographic;
  assert.equal(source.type, "raster");
  if (source.type !== "raster") throw Error("Expected raster source");
  assert.deepEqual(source.tiles, [
    "https://tile.opentopomap.org/{z}/{x}/{y}.png",
  ]);
  assert.equal(source.tileSize, 256);
  assert.equal(source.minzoom, 1);
  assert.equal(source.maxzoom, 17);
  for (const credit of [
    "OpenStreetMap",
    "viewfinderpanoramas.org",
    "SRTM",
    "Sonny",
    "OpenTopoMap",
    "CC BY-SA 3.0",
  ])
    assert.ok(source.attribution?.includes(credit));
  assert.deepEqual(topographicStyle.layers, [
    { id: "topographic", type: "raster", source: "topographic" },
  ]);
  assert.equal(topographicStyle.terrain, undefined);
  assert.equal(topographicStyle.glyphs, undefined);
  assert.equal(topographicStyle.sprite, undefined);
});

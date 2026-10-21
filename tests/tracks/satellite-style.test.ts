import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { createSatelliteStyle } from "../../tracks/satellite-style";

test("Satellite requests secure TileJSON templates and uses the active basemap source ID", () => {
  const style = createSatelliteStyle("pk.test+token");
  assert.deepEqual(validateStyleMin(style), []);
  assert.deepEqual(Object.keys(style.sources), ["satellite"]);
  const source = style.sources.satellite;
  assert.equal(source.type, "raster");
  if (source.type !== "raster" || !source.url) throw Error("Expected TileJSON");
  const url = new URL(source.url);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "api.mapbox.com");
  assert.equal(url.searchParams.get("secure"), "true");
  assert.equal(url.searchParams.get("access_token"), "pk.test+token");
  assert.equal(source.tileSize, 256);
  assert.deepEqual(style.layers, [
    { id: "satellite", type: "raster", source: "satellite" },
  ]);
});

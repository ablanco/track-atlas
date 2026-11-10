import { test } from "node:test";
import assert from "node:assert/strict";
import { mapRequest } from "../../tracks/map-request";

test("only the HTTPS Mapbox API and satellite tile origins receive a site referrer", () => {
  for (const origin of [
    "https://api.mapbox.com",
    "https://a.tiles.mapbox.com",
    "https://b.tiles.mapbox.com",
  ]) {
    const url = `${origin}/v4/mapbox.satellite.json?access_token=fixture`;
    assert.deepEqual(mapRequest(url), { url, referrerPolicy: "origin" });
  }
});

test("other providers, lookalike hosts and non-HTTPS requests omit the referrer", () => {
  for (const url of [
    "https://tiles.openfreemap.org/planet",
    "https://tile.opentopomap.org/1/0/0.png",
    "https://api.mapbox.com.example.test/tile",
    "https://example.test/api.mapbox.com",
    "https://api.mapbox.com@example.test/tile",
    "https://api.mapbox.com:8443/tile",
    "http://api.mapbox.com/tile",
    "//api.mapbox.com/tile",
    "/api/tracks/fixture/data",
    "not a URL",
  ]) {
    assert.deepEqual(mapRequest(url), { url, referrerPolicy: "no-referrer" });
  }
});

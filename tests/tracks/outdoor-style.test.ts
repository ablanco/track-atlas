import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createExpression,
  featureFilter,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import { createOutdoorStyle } from "../../tracks/outdoor-style";

for (const locale of ["en", "es"]) {
  test(`${locale}: Outdoor is a valid vector-only style with no terrain or sprite dependencies`, () => {
    const style = createOutdoorStyle(locale);
    assert.deepEqual(validateStyleMin(style), []);
    assert.deepEqual(style.sources, {
      outdoor: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    });
    assert.equal(
      style.glyphs,
      "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    );
    assert.equal(style.sprite, undefined);
    assert.equal(style.terrain, undefined);
    assert.equal(
      new Set(style.layers.map((layer) => layer.id)).size,
      style.layers.length,
    );
    assert.ok(
      style.layers.every(
        (layer) => layer.type !== "raster" && layer.type !== "hillshade",
      ),
    );
  });

  test(`${locale}: trail and peak names prefer the locale and preserve fallback names and zero elevation`, () => {
    const style = createOutdoorStyle(locale);
    const path = style.layers.find(
      (layer) => layer.id === "outdoor-path-names",
    );
    const peak = style.layers.find((layer) => layer.id === "outdoor-peaks");
    assert.equal(path?.type, "symbol");
    assert.equal(peak?.type, "symbol");
    if (path?.type !== "symbol" || peak?.type !== "symbol")
      throw Error("Missing labels");
    const evaluate = (value: unknown, properties: Record<string, unknown>) => {
      const expression = createExpression(value);
      assert.equal(expression.result, "success");
      if (expression.result !== "success") throw Error("Invalid expression");
      return expression.value.evaluate(
        { zoom: 14 },
        { type: "Point", properties },
      );
    };
    const properties = {
      name: "Local name",
      "name:en": "English name",
      "name:es": "Nombre español",
    };
    assert.equal(
      evaluate(path.layout?.["text-field"], properties),
      locale === "es" ? "Nombre español" : "English name",
    );
    assert.equal(
      evaluate(path.layout?.["text-field"], { name: "Local name" }),
      "Local name",
    );
    assert.equal(
      evaluate(path.layout?.["text-field"], { "name:latin": "Latin fallback" }),
      "Latin fallback",
    );
    assert.equal(
      evaluate(peak.layout?.["text-field"], { name: "Peak", ele: 0 }),
      "Peak\n0 m",
    );
    assert.equal(
      evaluate(peak.layout?.["text-field"], { name: "Peak" }),
      "Peak",
    );
  });
}

test("Outdoor emphasizes distinct paths and tracks without turning all roads into trails", () => {
  const style = createOutdoorStyle("en");
  const path = style.layers.find((layer) => layer.id === "outdoor-paths");
  const track = style.layers.find((layer) => layer.id === "outdoor-tracks");
  assert.ok(path?.type === "line" && track?.type === "line");
  for (const [layer, expected] of [
    [path, "path"],
    [track, "track"],
  ] as const) {
    assert.ok((layer.minzoom ?? 24) <= 11);
    const filter = featureFilter(layer.filter).filter;
    assert.equal(
      filter(
        { zoom: 14 },
        { type: "LineString", properties: { class: expected } },
      ),
      true,
    );
    assert.equal(
      filter(
        { zoom: 14 },
        { type: "LineString", properties: { class: "motorway" } },
      ),
      false,
    );
    assert.equal(
      filter({ zoom: 14 }, { type: "LineString", properties: {} }),
      false,
    );
    assert.equal(layer["source-layer"], "transportation");
  }
  assert.notDeepEqual(
    path.paint?.["line-dasharray"],
    track.paint?.["line-dasharray"],
  );
  assert.ok(
    style.layers.indexOf(path) >
      style.layers.findIndex((layer) => layer.id === "outdoor-major-roads"),
  );
  const pois = style.layers.find((layer) => layer.id === "outdoor-pois");
  assert.ok(pois && "filter" in pois);
  const filter = featureFilter(pois.filter).filter;
  assert.equal(
    filter(
      { zoom: 14 },
      { type: "Point", properties: { subclass: "alpine_hut" } },
    ),
    true,
  );
  assert.equal(
    filter(
      { zoom: 14 },
      { type: "Point", properties: { subclass: "supermarket" } },
    ),
    false,
  );
});

test("each Outdoor style is independent and keeps the recorded-path namespace separate", () => {
  const first = createOutdoorStyle("en");
  const second = createOutdoorStyle("en");
  first.layers.pop();
  assert.equal(first.layers.length + 1, second.layers.length);
  assert.ok(second.layers.every((layer) => layer.id.startsWith("outdoor-")));
  assert.equal(second.sources["recorded-path"], undefined);
  assert.equal(JSON.stringify(second).includes("opentopomap.org"), false);
});

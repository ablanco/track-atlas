import assert from "node:assert/strict";
import test from "node:test";
import { Geodesic } from "geographiclib-geodesic";
import { exploreDrawingGeometry } from "../../tracks/explore-spatial-geometry";
import type { ExploreDrawing } from "../../tracks/explore-types";

test("draft geometry bounds world-scale work while retaining endpoints and geographic corridor width", () => {
  const drawing: ExploreDrawing = {
    mode: "arrow",
    start: [0, 0],
    end: [170, 0],
    corridorKm: 1,
  };
  const preview = exploreDrawingGeometry(drawing, { maxSegments: 256 });
  assert.equal(preview.line.length, 257);
  assert.deepEqual(preview.line[0], [0, 0]);
  assert.deepEqual(preview.line.at(-1), [170, 0]);
  // An equatorial WGS84 corridor has its north side exactly 1 km north;
  // validate independently against GeographicLib, not the renderer's sampler.
  const north = Geodesic.WGS84.Direct(0, 0, 0, 1000).lat2!;
  assert.ok(
    Math.abs(Math.max(...preview.corridor.map((p) => p[1])) - north) < 1e-9,
  );
  const committed = exploreDrawingGeometry(drawing);
  assert.ok(committed.line.length > 18_000);
  assert.deepEqual(committed.line[0], preview.line[0]);
  assert.deepEqual(committed.line.at(-1), preview.line.at(-1));
});

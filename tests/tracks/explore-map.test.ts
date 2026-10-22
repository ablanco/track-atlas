import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareExplorePaths,
  readExploreGeometry,
} from "../../tracks/explore-map";

test("neighboring tracks across the dateline share a nearby world copy", () => {
  const paths = prepareExplorePaths([
    {
      id: "east",
      geometry: {
        type: "LineString",
        coordinates: [
          [179, 10],
          [-179, 11],
        ],
      },
    },
    {
      id: "west",
      geometry: {
        type: "LineString",
        coordinates: [
          [-179, 12],
          [-178, 13],
        ],
      },
    },
  ]);
  assert.deepEqual(paths.bounds, [
    [179, 10],
    [182, 13],
  ]);
  assert.deepEqual(paths.paths[0].geometry.coordinates, [
    [179, 10],
    [181, 11],
  ]);
  assert.deepEqual(paths.paths[1].geometry.coordinates, [
    [181, 12],
    [182, 13],
  ]);
});

test("polar paths retain their coordinates while the camera stays inside Mercator", () => {
  const geometry = {
    type: "LineString" as const,
    coordinates: [
      [1, -90],
      [2, 90],
    ] as [number, number][],
  };
  const result = prepareExplorePaths([{ id: "polar", geometry }]);
  assert.equal(result.polar, true);
  assert.deepEqual(result.bounds, [
    [1, -85.051129],
    [2, 85.051129],
  ]);
  assert.deepEqual(result.paths[0].geometry, geometry);
});

test("a full page of maximum-size paths keeps every position and an empty page has no fit", () => {
  const coordinates = Array.from(
    { length: 100_000 },
    (_, i): [number, number] => [i / 100_000, 40],
  );
  const tracks = Array.from({ length: 10 }, (_, i) => ({
    id: String(i),
    geometry: { type: "LineString" as const, coordinates },
  }));
  const result = prepareExplorePaths(tracks);
  assert.equal(result.paths.length, 10);
  assert.equal(result.paths[9].geometry.coordinates.length, 100_000);
  assert.deepEqual(result.bounds, [
    [0, 40],
    [0.99999, 40],
  ]);
  assert.deepEqual(prepareExplorePaths([]), {
    paths: [],
    bounds: null,
    polar: false,
  });
});

test("geometry delivery rejects malformed, oversized and non-geographic paths", () => {
  for (const coordinates of [
    [],
    [[1, 2]],
    [
      [181, 2],
      [1, 2],
    ],
    [
      [1, 91],
      [1, 2],
    ],
    [
      [1, null],
      [1, 2],
    ],
    [
      [1, 2, 3],
      [1, 2],
    ],
    Array(100_001).fill([1, 2]),
  ]) {
    assert.throws(() =>
      readExploreGeometry({ geometry: { type: "LineString", coordinates } }),
    );
  }
  assert.throws(() =>
    readExploreGeometry({
      geometry: {
        type: "Polygon",
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      },
    }),
  );
  assert.throws(() => readExploreGeometry(null));
  assert.deepEqual(
    readExploreGeometry({
      geometry: {
        type: "LineString",
        coordinates: [
          [180, -90],
          [-180, 90],
        ],
      },
    }),
    {
      type: "LineString",
      coordinates: [
        [180, -90],
        [-180, 90],
      ],
    },
  );
});

test("ten numbered results have distinct theme-token colors and stable assignments", async () => {
  const { getExploreTrackColor } = await import("../../tracks/explore-map");
  const colors = Array.from({ length: 10 }, (_, index) =>
    getExploreTrackColor(index),
  );
  assert.equal(new Set(colors).size, 10);
  assert.equal(colors[0], "var(--explore-path-1)");
  assert.equal(getExploreTrackColor(10), colors[0]);
});

test("progressive arrivals keep a stable world copy after the user moves the camera", () => {
  const page = prepareExplorePaths(
    [
      {
        id: "late",
        geometry: {
          type: "LineString",
          coordinates: [
            [179, 10],
            [-179, 11],
          ],
        },
      },
      {
        id: "first",
        geometry: {
          type: "LineString",
          coordinates: [
            [-179, 12],
            [-178, 13],
          ],
        },
      },
    ],
    -179,
  );
  assert.deepEqual(page.bounds, [
    [-181, 10],
    [-178, 13],
  ]);
});

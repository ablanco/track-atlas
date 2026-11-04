import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareExplorePaths,
  readExploreGeometry,
  readTrackGeometry,
  getExploreTrackColor,
} from "../../tracks/explore-map";
import type {
  TrackMultiLineString,
  TrackPosition,
} from "../../tracks/geometry";
const geometry = (...coordinates: TrackPosition[][]): TrackMultiLineString => ({
  type: "MultiLineString",
  coordinates,
});

test("segments unwrap independently and share the page anchor rather than the previous endpoint", () => {
  const source = geometry(
    [
      [179, 10],
      [-179, 11],
      [0, 12],
      [179, 13],
    ],
    [
      [-179, 20],
      [-178, 21],
    ],
  );
  const result = prepareExplorePaths([
    { id: "track", geometry: source },
    {
      id: "neighbor",
      geometry: geometry([
        [-179, 30],
        [-178, 31],
      ]),
    },
  ]);
  assert.deepEqual(result.paths[0].geometry.coordinates, [
    [
      [179, 10],
      [181, 11],
      [360, 12],
      [539, 13],
    ],
    [
      [181, 20],
      [182, 21],
    ],
  ]);
  assert.deepEqual(result.paths[1].geometry.coordinates, [
    [
      [181, 30],
      [182, 31],
    ],
  ]);
  assert.deepEqual(source.coordinates[1], [
    [-179, 20],
    [-178, 21],
  ]);
  assert.deepEqual(result.bounds, [
    [179, 10],
    [539, 31],
  ]);
});

test("progressive arrivals align every part to the stable reference longitude", () => {
  const result = prepareExplorePaths(
    [
      {
        id: "late",
        geometry: geometry(
          [
            [179, 10],
            [-179, 11],
          ],
          [
            [178, 12],
            [179, 13],
          ],
        ),
      },
    ],
    -179,
  );
  assert.deepEqual(result.bounds, [
    [-182, 10],
    [-179, 13],
  ]);
});

test("polar parts retain original positions while camera bounds clamp to Mercator", () => {
  const source = geometry([
    [1, -90],
    [2, 90],
  ]);
  const result = prepareExplorePaths([{ id: "polar", geometry: source }]);
  assert.equal(result.polar, true);
  assert.deepEqual(result.bounds, [
    [1, -85.051129],
    [2, 85.051129],
  ]);
  assert.deepEqual(result.paths[0].geometry, source);
  assert.deepEqual(prepareExplorePaths([]), {
    paths: [],
    bounds: null,
    polar: false,
  });
});

test("geometry responses accept singleton and 100 parts and reject malformed or excessive total vertices", () => {
  const part: TrackPosition[] = [
    [180, -90],
    [-180, 90],
  ];
  for (const source of [geometry(part), geometry(...Array(100).fill(part))])
    assert.deepEqual(readExploreGeometry({ geometry: source }), source);
  for (const source of [
    null,
    { type: "LineString", coordinates: part },
    geometry(),
    geometry([]),
    geometry([[1, 2]]),
    geometry(...Array(101).fill(part)),
    geometry(Array(2049).fill([1, 2])),
    geometry([
      [181, 2],
      [1, 2],
    ]),
    geometry([
      [1, 91],
      [1, 2],
    ]),
    {
      type: "MultiLineString",
      coordinates: [
        [
          [1, null],
          [1, 2],
        ],
      ],
    },
    {
      type: "MultiLineString",
      coordinates: [
        [
          [1, 2, 3],
          [1, 2],
        ],
      ],
    },
  ])
    assert.throws(() => readExploreGeometry({ geometry: source }));
});

test("a ten-track page preserves all 100 parts within the total display budget", () => {
  const source = geometry(
    ...Array.from(
      { length: 100 },
      (_, i) =>
        [
          [i, 0],
          [i + 0.1, 1],
        ] as TrackPosition[],
    ),
  );
  const result = prepareExplorePaths(
    Array.from({ length: 10 }, (_, i) => ({ id: String(i), geometry: source })),
  );
  assert.equal(result.paths.length, 10);
  assert.deepEqual(result.paths[9].geometry, source);
});

test("ten numbered results retain distinct stable theme-token colors", () => {
  const colors = Array.from({ length: 10 }, (_, i) => getExploreTrackColor(i));
  assert.equal(new Set(colors).size, 10);
  assert.equal(colors[0], "var(--explore-path-1)");
  assert.equal(getExploreTrackColor(10), colors[0]);
});

test("coincident endpoints remain individually named in one touch-accessible marker", async () => {
  const { prepareTrackEndpoints } = await import("../../tracks/explore-map");
  const source = geometry(
    [
      [0, 0],
      [1, 1],
    ],
    [
      [1, 1],
      [2, 2],
    ],
    [
      [0, 0],
      [1, 1],
      [0, 0],
    ],
  );
  const path = prepareExplorePaths([{ id: "track", geometry: source }]).paths[0]
    .geometry;
  assert.deepEqual(prepareTrackEndpoints(source, path), [
    {
      position: [0, 0],
      endpoints: [
        { segment: 1, kind: "start" },
        { segment: 3, kind: "startEnd" },
      ],
    },
    {
      position: [1, 1],
      endpoints: [
        { segment: 1, kind: "end" },
        { segment: 2, kind: "start" },
      ],
    },
    { position: [2, 2], endpoints: [{ segment: 2, kind: "end" }] },
  ]);
});

test("details retain all 100k original positions and repetitions while explorer uses a total vertex cap", () => {
  const part = Array.from({ length: 100_000 }, (_, i): TrackPosition => [
    Math.floor(i / 2) / 100_000,
    40,
  ]);
  const source = geometry(part);
  assert.equal(readTrackGeometry({ geometry: source }), source);
  assert.deepEqual(
    prepareExplorePaths([{ id: "details", geometry: source }]).paths[0]
      .geometry,
    source,
  );
  assert.throws(() => readExploreGeometry({ geometry: source }));
  assert.throws(() =>
    readExploreGeometry({
      geometry: geometry(...Array(100).fill(Array(21).fill([0, 0]))),
    }),
  );
  assert.throws(() =>
    readTrackGeometry({ geometry: geometry([...part, [0, 0]]) }),
  );
});

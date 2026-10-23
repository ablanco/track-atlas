import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseExploreFilters,
  serializeExploreFilters,
  withExploreSpatialFilters,
} from "../../tracks/explore-query";

test("explorer URLs round-trip canonical filters using kilometres and repeated choices", () => {
  const filters = parseExploreFilters(
    new URLSearchParams(
      "q=%20Peña%20forest%20&activity=hiking&activity=walking&activity=hiking&difficulty=5&difficulty=1&minDistance=1.25&maxDistance=12.5&maxElevationRange=42.5&visibility=private&page=3",
    ),
  );
  assert.deepEqual(filters, {
    q: "Peña forest",
    activities: ["hiking", "walking"],
    difficulties: [1, 5],
    minDistanceKm: 1.25,
    maxDistanceKm: 12.5,
    maxElevationRangeMeters: 42.5,
    visibility: "private",
    page: 3,
    viewport: null,
    drawing: null,
  });
  assert.deepEqual(
    parseExploreFilters(serializeExploreFilters(filters)),
    filters,
  );
  assert.equal(
    serializeExploreFilters(
      parseExploreFilters(new URLSearchParams()),
    ).toString(),
    "",
  );
});

test("explorer URLs reject unallowlisted, ambiguous and invalid filters", () => {
  for (const query of [
    "ownerId=x",
    "unknown=x",
    "q=a&q=b",
    "activity=flying",
    "difficulty=0",
    "difficulty=1.1",
    "minDistance=-1",
    "minDistance=",
    "maxDistance=Infinity",
    "maxDistance=NaN",
    "maxDistance=0x10",
    "minDistance=2&maxDistance=1",
    "maxElevationRange=-1",
    "visibility=secret",
    "page=0",
    "page=1.1",
    "page=9007199254740992",
    "q=%00",
    `q=${"a".repeat(201)}`,
  ]) {
    assert.throws(
      () => parseExploreFilters(new URLSearchParams(query)),
      { message: "invalidRequest" },
      query,
    );
  }
});

test("spatial URLs restore wrapped bounds and a finite drawing with a canonical default corridor", () => {
  const filters = parseExploreFilters(
    new URLSearchParams(
      "viewport=170,-20,-170,20&drawMode=arrow&drawStart=179,0&drawEnd=-179,0&page=2",
    ),
  );
  assert.deepEqual(filters.viewport, {
    west: 170,
    south: -20,
    east: -170,
    north: 20,
  });
  assert.deepEqual(filters.drawing, {
    mode: "arrow",
    start: [179, 0],
    end: [-179, 0],
    corridorKm: 1,
  });
  assert.equal(serializeExploreFilters(filters).get("corridorKm"), "1");
  assert.deepEqual(
    parseExploreFilters(serializeExploreFilters(filters)),
    filters,
  );
});

test("spatial URLs reject incomplete, ambiguous, nongeographic and degenerate criteria", () => {
  for (const query of [
    "viewport=0,0,0,1",
    "viewport=1,2,3,2",
    "viewport=180,0,-180,1",
    "viewport=-181,0,1,1",
    "viewport=0,-91,1,1",
    "viewport=0,0,1,91",
    "viewport=0,0,1,1&viewport=0,0,2,2",
    "viewport=0,0,NaN,1",
    "drawMode=arrow",
    "drawStart=0,0&drawEnd=1,1",
    "corridorKm=1",
    "drawMode=other&drawStart=0,0&drawEnd=1,1",
    "drawMode=arrow&drawStart=0,0&drawEnd=0,0",
    "drawMode=line&drawStart=180,0&drawEnd=-180,0",
    "drawMode=arrow&drawStart=0,90&drawEnd=42,90",
    "drawMode=arrow&drawStart=0,90&drawEnd=42,-90",
    "drawMode=line&drawStart=20,30&drawEnd=-160,-30",
    "drawMode=arrow&drawStart=0,0&drawEnd=181,0",
    "drawMode=arrow&drawStart=0,0&drawEnd=1,0&corridorKm=0.0999",
    "drawMode=arrow&drawStart=0,0&drawEnd=1,0&corridorKm=50.001",
    "drawMode=arrow&drawStart=0,0&drawEnd=1,0&drawMode=line",
  ])
    assert.throws(
      () => parseExploreFilters(new URLSearchParams(query)),
      { message: "invalidRequest" },
      query,
    );
  for (const query of [
    "viewport=-180,-90,180,90",
    "drawMode=line&drawStart=0,0&drawEnd=179.999999,0&corridorKm=50",
    "drawMode=arrow&drawStart=0,0&drawEnd=1e-8,0&corridorKm=0.1",
  ]) {
    const filters = parseExploreFilters(new URLSearchParams(query));
    assert.deepEqual(
      parseExploreFilters(serializeExploreFilters(filters)),
      filters,
    );
  }
});

test("committing or clearing spatial criteria resets pagination and preserves other filters", () => {
  const original = parseExploreFilters(
    new URLSearchParams("q=forest&page=4&activity=hiking"),
  );
  const next = withExploreSpatialFilters(original, {
    viewport: { west: 1, south: 2, east: 3, north: 4 },
    drawing: null,
  });
  assert.equal(next.page, 1);
  assert.equal(next.q, "forest");
  assert.deepEqual(next.activities, ["hiking"]);
  assert.deepEqual(next.viewport, { west: 1, south: 2, east: 3, north: 4 });
  const cleared = withExploreSpatialFilters(
    { ...next, page: 3 },
    { viewport: null, drawing: null },
  );
  assert.equal(cleared.page, 1);
  assert.equal(cleared.viewport, null);
  assert.equal(original.page, 4);
});

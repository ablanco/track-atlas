import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseExploreFilters,
  serializeExploreFilters,
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

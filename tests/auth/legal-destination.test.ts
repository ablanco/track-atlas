import assert from "node:assert/strict";
import { test } from "node:test";
import { safeLegalDestination } from "../../legal/destination";
test("renewal preserves local destinations and rejects redirect tricks and acceptance loops", () => {
  assert.equal(
    safeLegalDestination("/en/tracks?activity=hiking", "en"),
    "/en/tracks?activity=hiking",
  );
  for (const input of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/en/../accept-legal",
    "/en/accept-legal?returnTo=/en",
    "/api/files",
    "/en/tracks%0a",
    "javascript:alert(1)",
  ]) {
    assert.equal(safeLegalDestination(input, "es"), "/es");
  }
});

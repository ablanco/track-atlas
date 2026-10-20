import assert from "node:assert/strict";
import { test } from "node:test";
import { validateTrackInput, TrackError } from "../../tracks/validation";

test("invalid activity and missing required metadata return field errors without trusting privilege flags", () => {
  assert.throws(
    () =>
      validateTrackInput({
        name: " ",
        description: "",
        activity: "admin",
        difficulty: 0,
        tags: [],
        ownerId: "forged",
        visibility: "public",
      }),
    (error) =>
      error instanceof TrackError &&
      error.code === "invalidMetadata" &&
      error.fieldErrors?.name === "required" &&
      error.fieldErrors?.activity === "invalid" &&
      error.fieldErrors?.tags === "required",
  );
});

test("visibility is private by default, explicitly public, and rejects unknown values", () => {
  const input = {
    name: "Track",
    description: "Path",
    activity: "hiking",
    difficulty: 1,
    tags: ["forest"],
  };
  assert.equal(validateTrackInput(input).visibility, "private");
  assert.equal(
    validateTrackInput({ ...input, visibility: "public" }).visibility,
    "public",
  );
  for (const visibility of ["PUBLIC", "", null, true, "unlisted"])
    assert.throws(
      () => validateTrackInput({ ...input, visibility }),
      (error) =>
        error instanceof TrackError &&
        error.fieldErrors?.visibility === "invalid",
    );
});

test("required track metadata is trimmed and tags retain the first normalized spelling", () => {
  assert.deepEqual(
    validateTrackInput({
      name: " Loop ",
      description: " First line\nSecond line ",
      activity: "hiking",
      difficulty: 3,
      tags: [" Scenic ", "ＳＣＥＮＩＣ", "forest path"],
    }),
    {
      name: "Loop",
      description: "First line\nSecond line",
      activity: "hiking",
      difficulty: 3,
      tags: ["Scenic", "forest path"],
      visibility: "private",
    },
  );
});

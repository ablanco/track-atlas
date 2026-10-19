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
    },
  );
});

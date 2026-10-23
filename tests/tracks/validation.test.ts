import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateTrackInput,
  validateTrackEditInput,
  TrackError,
} from "../../tracks/validation";

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
      error.fieldErrors?.tags === undefined,
  );
});

test("tags may be empty while supplied tags must remain valid and bounded", () => {
  const input = {
    name: "Track",
    description: "Path",
    activity: "hiking",
    difficulty: 1,
    tags: [],
  };
  assert.deepEqual(validateTrackInput(input).tags, []);
  for (const tags of [
    undefined,
    null,
    "forest",
    {},
    [""],
    [" "],
    [1],
    ["bad\0tag"],
    ["x".repeat(31)],
    Array.from({ length: 11 }, (_, i) => `tag ${i}`),
  ])
    assert.throws(
      () => validateTrackInput({ ...input, tags }),
      (error) => error instanceof TrackError && !!error.fieldErrors?.tags,
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

test("edits require all six metadata fields and reject ownership, file and privilege inputs", () => {
  const input = {
    name: "Track",
    description: "Path",
    activity: "hiking",
    difficulty: 3,
    tags: [],
    visibility: "public",
  };
  for (const extra of ["ownerId", "file", "originalFileId", "admin", "version"])
    assert.throws(
      () => validateTrackEditInput({ ...input, [extra]: "forged" }),
      (error) => error instanceof TrackError && error.code === "invalidRequest",
    );
  const missing: Record<string, unknown> = { ...input };
  delete missing.visibility;
  assert.throws(() => validateTrackEditInput(missing));
  assert.deepEqual(validateTrackEditInput(input), input);
});

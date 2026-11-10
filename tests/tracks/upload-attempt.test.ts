import assert from "node:assert/strict";
import test from "node:test";
import { UploadAttempt, type UploadDraft } from "../../tracks/upload-attempt";

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const ownerId = "00000000-0000-4000-8000-000000000003";

function draft() {
  return {
    file: new File(["<gpx>original</gpx>"], "original.gpx", {
      type: "application/gpx+xml",
      lastModified: 1234,
    }),
    metadata: {
      name: "Mountain trip",
      description: "A day in the mountains",
      activity: "hiking",
      difficulty: 3,
      tags: ["summit", "weekend"],
      visibility: "public",
    },
    photos: [
      { id: secondId, caption: "At the start" },
      { id: firstId, caption: "At the summit" },
    ],
  };
}

function begin(attempt: UploadAttempt, input: UploadDraft = draft()) {
  const body = attempt.begin(input);
  assert.ok(body, "an eligible attempt supplies a multipart request");
  return body;
}

test("confirmed singleton success permits details navigation and a fresh submission identity", () => {
  const attempt = new UploadAttempt();
  const input = draft();
  const original = begin(attempt, input);
  assert.deepEqual(
    attempt.acknowledge(true, { id: firstId, ids: [firstId] }, ownerId),
    { kind: "success", destination: `/tracks/${firstId}` },
  );
  assert.equal(attempt.state, "editable");
  assert.equal(attempt.canEdit, true);
  assert.notEqual(
    begin(attempt, input).get("requestId"),
    original.get("requestId"),
  );
});

test("ordered multi-track success opens the current owner's receipt-scoped collection", () => {
  const attempt = new UploadAttempt();
  const body = begin(attempt);
  // Document order is deliberately different from lexical UUID order.
  assert.deepEqual(
    attempt.acknowledge(
      true,
      { id: secondId, ids: [secondId, firstId] },
      ownerId,
    ),
    {
      kind: "success",
      destination: `/users/${ownerId}/tracks?created=${body.get("requestId")}`,
    },
  );
  assert.equal(attempt.canEdit, true);
});

test("the maximum 100 ordered results can confirm success", () => {
  const attempt = new UploadAttempt();
  const body = begin(attempt);
  const ids = Array.from(
    { length: 100 },
    (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  assert.deepEqual(attempt.acknowledge(true, { id: firstId, ids }, ownerId), {
    kind: "success",
    destination: `/users/${ownerId}/tracks?created=${body.get("requestId")}`,
  });
});

const malformedSuccesses: [string, unknown][] = [
  ["null", null],
  ["array", []],
  ["missing ids", { id: firstId }],
  ["non-array ids", { id: firstId, ids: firstId }],
  ["empty ids", { id: firstId, ids: [] }],
  ["duplicate ids", { id: firstId, ids: [firstId, firstId] }],
  ["mismatched first id", { id: firstId, ids: [secondId, firstId] }],
  ["missing first id", { ids: [firstId] }],
  ["invalid first id", { id: "invalid", ids: ["invalid"] }],
  ["invalid later id", { id: firstId, ids: [firstId, "invalid"] }],
  ["non-string later id", { id: firstId, ids: [firstId, 42] }],
  [
    "101 unique ids",
    {
      id: firstId,
      ids: Array.from(
        { length: 101 },
        (_, index) =>
          `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      ),
    },
  ],
  ["2xx containing a rejection", { error: "invalidMetadata" }],
];
for (const [label, response] of malformedSuccesses) {
  test(`malformed success (${label}) retains the attempt without permitting reset or edits`, () => {
    const attempt = new UploadAttempt();
    const original = begin(attempt);
    const result = attempt.acknowledge(true, response, ownerId);
    assert.equal(result.kind, "failure");
    assert.equal("destination" in result, false);
    assert.equal(attempt.state, "uncertain");
    assert.equal(attempt.canEdit, false);
    assert.deepEqual([...begin(attempt).entries()], [...original.entries()]);
  });
}

for (const outcome of [
  "lost acknowledgement",
  "processing",
  "unavailable",
  "unknown rejection",
  "unreadable acknowledgement",
] as const) {
  test(`${outcome} retries the frozen File, metadata and photos after expiry and draft replacement`, async () => {
    const attempt = new UploadAttempt();
    const input = draft();
    const originalFile = input.file;
    const original = begin(attempt, input);
    const requestId = original.get("requestId");
    assert.match(String(requestId), /^[a-f0-9-]{36}$/);
    const result =
      outcome === "lost acknowledgement" ||
      outcome === "unreadable acknowledgement"
        ? attempt.unavailable()
        : attempt.acknowledge(
            false,
            {
              error: outcome === "unknown rejection" ? "futureError" : outcome,
            },
            ownerId,
          );
    assert.equal(result.kind, "failure");
    assert.equal(
      result.code,
      outcome === "processing" ? "processing" : "unavailable",
    );
    assert.equal(attempt.state, "uncertain");
    assert.equal(attempt.canEdit, false);
    assert.equal(attempt.canSubmit(false, true), true);

    // Mutate every shared reference, then simulate expired leases and a new draft.
    input.metadata.name = "Replacement";
    input.metadata.description = "Changed description";
    input.metadata.activity = "cycling";
    input.metadata.difficulty = 1;
    input.metadata.visibility = "private";
    input.metadata.tags.reverse();
    input.metadata.tags.push("changed");
    input.photos[0].caption = "Changed caption";
    input.photos[0].id = ownerId;
    input.photos.reverse();
    input.photos.splice(0);
    input.file = new File(["replacement"], "replacement.gpx");

    // No current file/metadata/readiness is needed to resolve the old attempt.
    const replay = begin(attempt, {
      file: undefined,
      metadata: null,
      photos: [],
    });
    assert.strictEqual(replay.get("file"), originalFile);
    assert.equal(await originalFile.text(), "<gpx>original</gpx>");
    assert.equal(originalFile.name, "original.gpx");
    assert.equal(originalFile.lastModified, 1234);
    assert.deepEqual(Object.fromEntries(replay), {
      name: "Mountain trip",
      description: "A day in the mountains",
      activity: "hiking",
      difficulty: "3",
      visibility: "public",
      tags: '["summit","weekend"]',
      photos:
        '[{"id":"00000000-0000-4000-8000-000000000002","caption":"At the start"},{"id":"00000000-0000-4000-8000-000000000001","caption":"At the summit"}]',
      requestId,
      file: originalFile,
    });
    assert.deepEqual(
      attempt.acknowledge(true, { id: firstId, ids: [firstId] }, ownerId),
      { kind: "success", destination: `/tracks/${firstId}` },
    );
    assert.equal(attempt.canEdit, true);
    assert.notEqual(begin(attempt, draft()).get("requestId"), requestId);
  });
}

for (const code of [
  "unauthorized",
  "emailUnconfirmed",
  "invalidRequest",
  "invalidMetadata",
  "invalidFile",
  "invalidSegment",
  "unsupportedStructure",
  "tooLarge",
  "tooManyPoints",
  "tooManyTracks",
  "tooManySegments",
  "notFound",
  "quotaExceeded",
  "forbidden",
  "conflict",
  "processingTimeout",
]) {
  test(`definitive ${code} rejection permits correction and retains unchanged submission identity`, () => {
    const attempt = new UploadAttempt();
    const input = draft();
    const original = begin(attempt, input);
    assert.deepEqual(attempt.acknowledge(false, { error: code }, ownerId), {
      kind: "failure",
      code,
      fields: undefined,
      track: null,
      segment: null,
    });
    assert.equal(attempt.state, "editable");
    assert.equal(attempt.canEdit, true);
    assert.deepEqual([...begin(attempt, input)], [...original]);
    attempt.acknowledge(false, { error: code }, ownerId);
    input.metadata.name = "Corrected title";
    const corrected = begin(attempt, input);
    assert.equal(corrected.get("name"), "Corrected title");
    assert.notEqual(corrected.get("requestId"), original.get("requestId"));
  });
}

test("server validation exposes only supported fields and bounded track/segment positions", () => {
  const attempt = new UploadAttempt();
  begin(attempt);
  assert.deepEqual(
    attempt.acknowledge(
      false,
      {
        error: "invalidSegment",
        fieldErrors: { file: "invalid", name: "tooLong", privilege: "invalid" },
        track: 2,
        segment: 3,
      },
      ownerId,
    ),
    {
      kind: "failure",
      code: "invalidSegment",
      fields: { name: true, file: true },
      track: 2,
      segment: 3,
    },
  );
  begin(attempt);
  assert.deepEqual(
    attempt.acknowledge(
      false,
      { error: "invalidFile", track: 101, segment: 1 },
      ownerId,
    ),
    {
      kind: "failure",
      code: "invalidFile",
      fields: undefined,
      track: null,
      segment: null,
    },
  );
});

test("readiness gates new submissions, pending blocks duplicates, and uncertainty allows resolution", () => {
  const attempt = new UploadAttempt();
  assert.equal(attempt.state, "editable");
  assert.equal(attempt.canEdit, true);
  assert.equal(attempt.canSubmit(false, false), false);
  assert.equal(attempt.canSubmit(false, true), false);
  assert.equal(attempt.canSubmit(true, true), false);
  assert.equal(attempt.canSubmit(true, false), true);
  const input = draft();
  const original = begin(attempt, input);
  assert.equal(attempt.state, "pending");
  assert.equal(attempt.canEdit, false);
  for (const previewReady of [false, true]) {
    for (const photosBusy of [false, true]) {
      assert.equal(attempt.canSubmit(previewReady, photosBusy), false);
    }
  }
  // A duplicate cannot validate or capture a replacement draft while pending.
  assert.equal(
    attempt.begin({ file: undefined, metadata: null, photos: [] }),
    null,
  );
  attempt.unavailable();
  for (const previewReady of [false, true]) {
    for (const photosBusy of [false, true]) {
      assert.equal(attempt.canSubmit(previewReady, photosBusy), true);
    }
  }
  assert.deepEqual([...begin(attempt)], [...original]);
  assert.equal(attempt.begin(draft()), null);
});

const corrections: [string, (input: ReturnType<typeof draft>) => void][] = [
  [
    "a different File object with identical bytes",
    (input) => {
      input.file = new File(["<gpx>original</gpx>"], "original.gpx", {
        type: "application/gpx+xml",
        lastModified: 1234,
      });
    },
  ],
  [
    "metadata",
    (input) => {
      input.metadata.visibility = "private";
    },
  ],
  [
    "photo identity",
    (input) => {
      input.photos[0].id = ownerId;
    },
  ],
  [
    "photo order",
    (input) => {
      input.photos.reverse();
    },
  ],
  [
    "photo caption",
    (input) => {
      input.photos[0].caption = "Corrected caption";
    },
  ],
];
for (const [label, correct] of corrections) {
  test(`after rejection, correcting ${label} starts a new attempt`, () => {
    const attempt = new UploadAttempt();
    const input = draft();
    const original = begin(attempt, input);
    attempt.acknowledge(false, { error: "invalidFile" }, ownerId);
    correct(input);
    const corrected = begin(attempt, input);
    assert.notEqual(corrected.get("requestId"), original.get("requestId"));
    attempt.unavailable();
    assert.deepEqual([...begin(attempt)], [...corrected]);
  });
}

for (const [label, invalid, expected] of [
  [
    "missing File",
    { file: undefined, metadata: draft().metadata, photos: [] },
    { code: "invalidMetadata", fieldErrors: { file: "required" } },
  ],
  [
    "invalid metadata",
    { ...draft(), metadata: null },
    { code: "invalidMetadata" },
  ],
  [
    "oversized File",
    {
      ...draft(),
      file: new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.gpx"),
    },
    { code: "tooLarge", fieldErrors: { file: "invalid" } },
  ],
] as const) {
  test(`${label} fails local validation without locking correction`, () => {
    const attempt = new UploadAttempt();
    assert.throws(() => attempt.begin(invalid), expected);
    assert.equal(attempt.state, "editable");
    assert.equal(attempt.canEdit, true);
    assert.ok(begin(attempt));
  });
}

test("a non-success HTTP status cannot confirm success even with valid result IDs", () => {
  const attempt = new UploadAttempt();
  const original = begin(attempt);
  const result = attempt.acknowledge(
    false,
    { id: firstId, ids: [firstId] },
    ownerId,
  );
  assert.equal(result.kind, "failure");
  assert.equal(attempt.canEdit, false);
  assert.deepEqual([...begin(attempt)], [...original]);
});

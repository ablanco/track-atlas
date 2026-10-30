import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { validatePhotos } from "../../tracks/photos";
test("gallery input preserves repeated content identities and captions but rejects duplicate references, oversized galleries and privilege fields", () => {
  const first = { id: randomUUID(), caption: "<script>plain text</script>" };
  assert.deepEqual(
    validatePhotos([first, { id: randomUUID(), caption: "" }])[0],
    first,
  );
  assert.throws(() => validatePhotos([first, first]));
  assert.throws(() =>
    validatePhotos(
      Array.from({ length: 21 }, () => ({ id: randomUUID(), caption: "" })),
    ),
  );
  assert.throws(() => validatePhotos([{ ...first, caption: "a".repeat(501) }]));
  assert.throws(() => validatePhotos([{ ...first, ownerId: randomUUID() }]));
});

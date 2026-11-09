import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getLegalRevision,
  hasRequiredLegalRevision,
} from "../../legal/documents";

test("cookie-disclosure correction preserves the originally acknowledged privacy generation", () => {
  assert.equal(
    getLegalRevision("privacy", "2026-11-03.1")?.version,
    "2026-11-03.1",
  );
  assert.equal(
    getLegalRevision("privacy", "2026-11-03")?.messageKey,
    "r20261103",
  );
  assert.equal(hasRequiredLegalRevision("privacy", "2026-11-03"), true);
  assert.equal(hasRequiredLegalRevision("privacy", "2026-11-03.1"), true);
  assert.equal(hasRequiredLegalRevision("privacy", "unknown"), false);
});

for (const document of ["terms", "privacy"] as const) {
  test(`${document} contact correction preserves previous acceptance`, () => {
    assert.equal(getLegalRevision(document)?.version, "2026-11-09");
    assert.equal(getLegalRevision(document)?.messageKey, "r20261109");
    assert.equal(hasRequiredLegalRevision(document, "2026-11-03"), true);
    assert.equal(hasRequiredLegalRevision(document, "2026-11-09"), true);
  });
}

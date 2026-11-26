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
  assert.equal(
    getLegalRevision("privacy", "2026-11-03")?.requiredVersion,
    "2026-11-03",
  );
  assert.equal(
    getLegalRevision("privacy", "2026-11-03.1")?.requiredVersion,
    "2026-11-03",
  );
  assert.equal(hasRequiredLegalRevision("privacy", "unknown"), false);
});

for (const document of ["terms", "privacy"] as const) {
  test(`${document} contact correction preserves previous acceptance`, () => {
    assert.equal(
      getLegalRevision(document, "2026-11-09")?.version,
      "2026-11-09",
    );
    assert.equal(
      getLegalRevision(document, "2026-11-09")?.messageKey,
      "r20261109",
    );
    assert.equal(
      getLegalRevision(document, "2026-11-03")?.requiredVersion,
      "2026-11-03",
    );
    assert.equal(
      getLegalRevision(document, "2026-11-09")?.requiredVersion,
      "2026-11-03",
    );
  });
}

test("weather disclosure requires renewed privacy acknowledgment while retaining terms acceptance", () => {
  assert.equal(getLegalRevision("privacy")?.version, "2026-11-25");
  assert.equal(hasRequiredLegalRevision("privacy", "2026-11-09"), false);
  assert.equal(hasRequiredLegalRevision("privacy", "2026-11-25"), true);
  assert.equal(hasRequiredLegalRevision("terms", "2026-11-09"), true);
});

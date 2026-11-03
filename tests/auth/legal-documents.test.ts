import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getLegalRevision,
  hasRequiredLegalRevision,
} from "../../legal/documents";

test("cookie-disclosure correction preserves the originally acknowledged privacy generation", () => {
  assert.equal(getLegalRevision("privacy")?.version, "2026-11-03.1");
  assert.equal(
    getLegalRevision("privacy", "2026-11-03")?.messageKey,
    "r20261103",
  );
  assert.equal(hasRequiredLegalRevision("privacy", "2026-11-03"), true);
  assert.equal(hasRequiredLegalRevision("privacy", "2026-11-03.1"), true);
  assert.equal(hasRequiredLegalRevision("privacy", "unknown"), false);
});

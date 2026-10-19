import assert from "node:assert/strict";
import { test } from "node:test";
import { readAccountLinkToken } from "../../auth/account-link-query";
test("link query accepts one canonical authority and ignores arbitrary redirects", () => {
  const token = "A".repeat(43);
  assert.equal(
    readAccountLinkToken({ token, returnTo: "https://evil.test" }),
    token,
  );
  for (const query of [
    {},
    { token: [token, token] },
    { token: "x".repeat(9999) },
    { token: "x".repeat(43) },
  ])
    assert.equal(readAccountLinkToken(query), null);
});

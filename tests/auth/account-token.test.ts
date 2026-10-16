import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createAccountToken, isAccountToken } from "../../auth/account-token";
import { emailRateKey } from "../../auth/email-rate-limit";
test("account secrets are canonical random tokens and only their digest is stored", () => {
  const a = createAccountToken(), b = createAccountToken();
  assert.notEqual(a.token, b.token); assert.equal(a.token.length, 43);
  assert.equal(a.tokenHash, createHash("sha256").update(a.token).digest("hex"));
  assert.equal(isAccountToken(a.token), true);
  for (const bad of ["", "a".repeat(42), a.token + "=", "x".repeat(43), null, [a.token]]) assert.equal(isAccountToken(bad), false);
});
test("email rate keys are normalized and private", () => {
  const key = emailRateKey(" Ada@Example.Test ", "s".repeat(64));
  assert.equal(key, emailRateKey("ada@example.test", "s".repeat(64)));
  assert.notEqual(key, emailRateKey("ada@example.test", "x".repeat(64)));
  assert.equal(key.includes("ada"), false);
});

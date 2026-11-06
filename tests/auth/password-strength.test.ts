import assert from "node:assert/strict";
import { test } from "node:test";
import {
  measurePassword,
  passwordStrengthError,
} from "../../auth/password-strength";

test("rejects guessable passwords and common words across supported languages", async () => {
  for (const password of [
    "12345678",
    "P@ssw0rd!",
    "aaaaaaaaaaaaaaaaaaaa",
    "   ",
    "password",
    "contraseña",
    "motdepasse",
    "senha",
    "passwort",
    "password1",
    "TrackAtlas2026!",
  ]) {
    assert.equal(await passwordStrengthError(password), "weak");
  }
});

test("accepts scores 3 and 4 and rejects score 2", async () => {
  assert.equal(await measurePassword("new password"), 2);
  assert.equal(await passwordStrengthError("new password"), "weak");
  assert.equal(await measurePassword("secret-password"), 3);
  assert.equal(await passwordStrengthError("secret-password"), undefined);
  assert.equal(await measurePassword(" violet otter brass lantern "), 4);
  assert.equal(
    await passwordStrengthError(" violet otter brass lantern "),
    undefined,
  );
});

test("bounds UTF-8 bytes before scoring and rejects long repetition", async () => {
  assert.equal(await passwordStrengthError(""), "required");
  assert.equal(await passwordStrengthError("é".repeat(513)), "tooLong");
  assert.equal(await passwordStrengthError("a".repeat(1025)), "tooLong");
  assert.equal(await measurePassword("a".repeat(1025)), 0);
  assert.equal(await passwordStrengthError("a".repeat(1024)), "weak");
});

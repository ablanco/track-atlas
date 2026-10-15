import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSignup } from "../../auth/validation";

const today = "2026-10-15";
function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ firstName: "Ada", lastName: "Lovelace", email: "Ada@example.test", dateOfBirth: "1815-12-10", password: "x", ...overrides })) data.set(key, value);
  return data;
}

test("normalizes only profile fields and never echoes the password", () => {
  const data = form({ firstName: " Ada ", email: " Ada@example.test ", displayName: "  ", password: " x " });
  data.set("active", "false");
  data.set("admin", "true");
  data.set("emailConfirmed", "true");
  data.set("email_confirmed", "true");
  data.set("avatarUrl", "https://example.test/avatar");
  const result = validateSignup(data, today);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.input, { firstName: "Ada", lastName: "Lovelace", email: "Ada@example.test", dateOfBirth: "1815-12-10", password: " x ", displayName: null });
  assert.equal("password" in result.values, false);
});

for (const field of ["firstName", "lastName", "email", "dateOfBirth", "password", "displayName"] as const) {
  for (const kind of ["missing", "repeated", "file"] as const) {
    test(`validates ${kind} ${field} on server`, () => {
      const data = form();
      if (kind === "missing") data.delete(field);
      if (kind === "repeated") { data.set(field, "one"); data.append(field, "two"); }
      if (kind === "file") data.set(field, new File(["test"], "test.txt"));
      const result = validateSignup(data, today);
      if (field === "displayName" && kind === "missing") { assert.equal(result.ok, true); return; }
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.errors[field], kind === "missing" ? "required" : "invalid");
      assert.equal("password" in result.values, false);
      assert.ok(!JSON.stringify(result).includes('"password":"x"'));
    });
  }
}
for (const field of ["firstName", "lastName", "email"] as const) {
  test(`rejects whitespace-only ${field}`, () => {
    const result = validateSignup(form({ [field]: " \t " }), today);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errors[field], "required");
  });
}
for (const [birthday, code] of [["0001-01-01", null], ["2000-02-29", null], [today, null], ["1900-02-29", "invalid"], ["2026-02-30", "invalid"], ["0000-01-01", "invalid"], ["2026-1-01", "invalid"], ["2026-10-16", "future"]] as const) {
  test(`validates calendar birthday ${birthday}`, () => {
    const result = validateSignup(form({ dateOfBirth: birthday }), today);
    assert.equal(result.ok, code === null);
    if (!result.ok) assert.equal(result.errors.dateOfBirth, code);
  });
}
for (const field of ["firstName", "lastName", "displayName"] as const) {
  for (const count of [200, 201]) test(`bounds ${field} at ${count} Unicode characters`, () => {
    const result = validateSignup(form({ [field]: "🌍".repeat(count) }), today);
    assert.equal(result.ok, count === 200);
    if (!result.ok) assert.equal(result.errors[field], "tooLong");
  });
}
for (const [password, valid] of [["x", true], ["   ", true], ["x".repeat(1024), true], ["x".repeat(1025), false], ["é".repeat(512), true], ["é".repeat(513), false]] as const) {
  test(`bounds password ${Buffer.byteLength(password)} UTF-8 bytes without strength rules`, () => {
    const result = validateSignup(form({ password }), today);
    assert.equal(result.ok, valid);
    if (!result.ok) { assert.equal(result.errors.password, "tooLong"); assert.ok(!JSON.stringify(result).includes(password)); }
  });
}
for (const size of [254, 255]) test(`bounds email length ${size}`, () => {
  const email = `${"a".repeat(60)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(size - 188)}.test`;
  assert.equal(email.length, size);
  const result = validateSignup(form({ email }), today);
  assert.equal(result.ok, size === 254);
  if (!result.ok) assert.equal(result.errors.email, "tooLong");
});
for (const email of ["broken", "a b@example.test", "a\n@example.test", "a@", "@example.test"]) test(`rejects invalid email ${JSON.stringify(email)}`, () => {
  const result = validateSignup(form({ email }), today);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.email, "invalid");
});

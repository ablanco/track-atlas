import { legalDocuments } from "../../legal/documents";
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSignup } from "../../auth/validation";

const today = "2026-10-15";
function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    firstName: "Ada",
    lastName: "Lovelace",
    email: "Ada@example.test",
    dateOfBirth: "1815-12-10",
    password: "x",
    termsAccepted: "on",
    privacyAcknowledged: "on",
    termsVersion: legalDocuments.terms.currentVersion,
    privacyVersion: legalDocuments.privacy.currentVersion,
    ...overrides,
  }))
    data.set(key, value);
  return data;
}

test("normalizes only profile fields and never echoes the password", () => {
  const data = form({
    firstName: " Ada ",
    email: " Ada@example.test ",
    displayName: "  ",
    password: " x ",
  });
  data.set("active", "false");
  data.set("admin", "true");
  data.set("emailConfirmed", "true");
  data.set("email_confirmed", "true");
  data.set("avatarUrl", "https://example.test/avatar");
  const result = validateSignup(data, today);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.input, {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "Ada@example.test",
    dateOfBirth: "1815-12-10",
    password: " x ",
    displayName: null,
    legalAcceptance: {
      termsVersion: legalDocuments.terms.currentVersion,
      privacyVersion: legalDocuments.privacy.currentVersion,
      locale: "en",
    },
  });
  assert.equal("password" in result.values, false);
});

for (const field of [
  "firstName",
  "lastName",
  "email",
  "dateOfBirth",
  "password",
  "displayName",
] as const) {
  for (const kind of ["missing", "repeated", "file"] as const) {
    test(`validates ${kind} ${field} on server`, () => {
      const data = form();
      if (kind === "missing") data.delete(field);
      if (kind === "repeated") {
        data.set(field, "one");
        data.append(field, "two");
      }
      if (kind === "file") data.set(field, new File(["test"], "test.txt"));
      const result = validateSignup(data, today);
      if (field === "displayName" && kind === "missing") {
        assert.equal(result.ok, true);
        return;
      }
      assert.equal(result.ok, false);
      if (!result.ok)
        assert.equal(
          result.errors[field],
          kind === "missing" ? "required" : "invalid",
        );
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
for (const [birthday, code] of [
  ["0001-01-01", null],
  ["2000-02-29", null],
  [today, "underage"],
  ["1900-02-29", "invalid"],
  ["2026-02-30", "invalid"],
  ["0000-01-01", "invalid"],
  ["2026-1-01", "invalid"],
  ["2026-10-16", "future"],
] as const) {
  test(`validates calendar birthday ${birthday}`, () => {
    const result = validateSignup(form({ dateOfBirth: birthday }), today);
    assert.equal(result.ok, code === null);
    if (!result.ok) assert.equal(result.errors.dateOfBirth, code);
  });
}
for (const field of ["firstName", "lastName", "displayName"] as const) {
  for (const count of [200, 201])
    test(`bounds ${field} at ${count} Unicode characters`, () => {
      const result = validateSignup(
        form({ [field]: "🌍".repeat(count) }),
        today,
      );
      assert.equal(result.ok, count === 200);
      if (!result.ok) assert.equal(result.errors[field], "tooLong");
    });
}
for (const [password, valid] of [
  ["x", true],
  ["   ", true],
  ["x".repeat(1024), true],
  ["x".repeat(1025), false],
  ["é".repeat(512), true],
  ["é".repeat(513), false],
] as const) {
  test(`structural parser bounds password ${Buffer.byteLength(password)} UTF-8 bytes before scoring`, () => {
    const result = validateSignup(form({ password }), today);
    assert.equal(result.ok, valid);
    if (!result.ok) {
      assert.equal(result.errors.password, "tooLong");
      assert.ok(!JSON.stringify(result).includes(password));
    }
  });
}
for (const size of [254, 255])
  test(`bounds email length ${size}`, () => {
    const email = `${"a".repeat(60)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(size - 188)}.test`;
    assert.equal(email.length, size);
    const result = validateSignup(form({ email }), today);
    assert.equal(result.ok, size === 254);
    if (!result.ok) assert.equal(result.errors.email, "tooLong");
  });
for (const email of [
  "broken",
  "a b@example.test",
  "a\n@example.test",
  "a@",
  "@example.test",
])
  test(`rejects invalid email ${JSON.stringify(email)}`, () => {
    const result = validateSignup(form({ email }), today);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errors.email, "invalid");
  });

test("signup requires separate explicit current legal acknowledgments", () => {
  for (const field of [
    "termsAccepted",
    "privacyAcknowledged",
    "termsVersion",
    "privacyVersion",
  ]) {
    for (const kind of ["missing", "duplicate", "malformed", "file", "stale"]) {
      const data = form();
      if (kind === "missing") data.delete(field);
      if (kind === "duplicate") data.append(field, String(data.get(field)));
      if (kind === "malformed") data.set(field, "true");
      if (kind === "file") data.set(field, new File(["on"], "proof.txt"));
      if (kind === "stale") data.set(field, "2000-01-01");
      const result = validateSignup(data, today);
      assert.equal(result.ok, false, `${field}: ${kind}`);
      if (!result.ok)
        assert.ok(
          result.errors[
            field.startsWith("terms") ? "termsAccepted" : "privacyAcknowledged"
          ],
        );
      assert.equal("password" in result.values, false);
    }
  }
});

for (const [birth, date, valid] of [
  ["2008-10-15", "2026-10-15", true],
  ["2008-10-16", "2026-10-15", false],
  ["2008-02-29", "2026-02-28", false],
  ["2008-02-29", "2026-03-01", true],
  ["2006-02-28", "2024-02-29", true],
  ["2006-03-01", "2024-02-29", false],
] as const)
  test(`adult calendar boundary ${birth} on ${date}`, () => {
    const result = validateSignup(form({ dateOfBirth: birth }), date);
    assert.equal(result.ok, valid);
    if (!result.ok) assert.equal(result.errors.dateOfBirth, "underage");
  });

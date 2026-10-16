import assert from "node:assert/strict";
import { test } from "node:test";
import { validateProfile, validatePassword } from "../../auth/settings-validation";

function profile() {
  const form = new FormData();
  form.set("firstName", " Ada "); form.set("lastName", " Lovelace ");
  return form;
}
function password(value = " x ", confirmation = value) {
  const form = new FormData();
  form.set("password", value); form.set("passwordConfirmation", confirmation);
  return form;
}
test("profile trims names, normalizes empty display name, and ignores immutable injected fields", () => {
  const form = profile();
  for (const key of ["email", "userId", "active", "admin", "emailConfirmed", "password"]) form.set(key, "injected");
  assert.deepEqual(validateProfile(form), { ok: true, input: { firstName: "Ada", lastName: "Lovelace", displayName: null }, values: { firstName: "Ada", lastName: "Lovelace", displayName: "" } });
  form.set("displayName", " Countess ");
  const parsed = validateProfile(form);
  assert.ok(parsed.ok); assert.equal(parsed.input.displayName, "Countess");
});
for (const field of ["firstName", "lastName", "displayName"] as const) {
  for (const kind of ["duplicate", "file", "blank", "missing", "limit", "over-limit"] as const) test(`profile ${field} ${kind}`, () => {
    const form = profile(); form.set(field, "valid");
    if (kind === "duplicate") form.append(field, "duplicate");
    if (kind === "file") form.set(field, new Blob(["private"]), "file");
    if (kind === "blank") form.set(field, "   ");
    if (kind === "missing") form.delete(field);
    if (kind === "limit" || kind === "over-limit") form.set(field, "😀".repeat(kind === "limit" ? 200 : 201));
    const parsed = validateProfile(form);
    const optional = field === "displayName" && (kind === "missing" || kind === "blank");
    assert.equal(parsed.ok, kind === "limit" || optional);
    assert.ok(Array.from(parsed.values[field]).length <= 200);
    if (!parsed.ok) assert.equal(parsed.errors[field], kind === "duplicate" || kind === "file" ? "invalid" : kind === "over-limit" ? "tooLong" : "required");
  });
}
for (const [value, want] of [[" x ", true], [" ", true], ["", false], ["a".repeat(1024), true], ["a".repeat(1025), false], ["😀".repeat(256), true], ["😀".repeat(257), false]] as const) test(`password validation preserves whitespace and bounds ${Buffer.byteLength(value)} bytes`, () => {
  const parsed = validatePassword(password(value));
  assert.equal(parsed.ok, want);
  if (parsed.ok) assert.deepEqual(parsed.input, { password: value });
  else { assert.equal(parsed.errors.password, value ? "tooLong" : "required"); assert.equal(JSON.stringify(parsed).includes(value || "not-a-secret"), false); }
});
for (const field of ["password", "passwordConfirmation"] as const) for (const kind of ["missing", "duplicate", "file", "blank", "tooLong"] as const) test(`rejects ${kind} ${field} without echoing either secret`, () => {
  const form = password("private-secret");
  if (kind === "missing") form.delete(field);
  if (kind === "duplicate") form.append(field, "private-secret");
  if (kind === "file") form.set(field, new Blob(["private-secret"]), "file");
  if (kind === "blank") form.set(field, "");
  if (kind === "tooLong") form.set(field, "a".repeat(1025));
  const parsed = validatePassword(form);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.errors[field], kind === "missing" || kind === "blank" ? "required" : kind === "tooLong" ? "tooLong" : "invalid");
  assert.ok(!JSON.stringify(parsed).includes("private-secret"));
});
test("password confirmation matches exactly without trimming", () => {
  assert.deepEqual(validatePassword(password(" x ", "x")), { ok: false, errors: { passwordConfirmation: "mismatch" } });
});

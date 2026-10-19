import assert from "node:assert/strict";
import { test } from "node:test";
import { validateLogin } from "../../auth/login-validation";

function form(email = " Ada@Example.test ", password = " x ") {
  const result = new FormData();
  result.set("email", email);
  result.set("password", password);
  return result;
}
test("login trims email but preserves password and ignores privileges", () => {
  const input = form();
  input.set("admin", "true");
  assert.deepEqual(validateLogin(input), {
    ok: true,
    input: { email: "Ada@Example.test", password: " x " },
    values: { email: "Ada@Example.test" },
  });
});
for (const field of ["email", "password"] as const)
  for (const kind of ["missing", "duplicate", "file", "empty"] as const)
    test(`login rejects ${kind} ${field}`, () => {
      const input = form();
      if (kind === "missing") input.delete(field);
      if (kind === "duplicate") input.append(field, "second");
      if (kind === "file")
        input.set(field, new File(["secret"], "private.txt"));
      if (kind === "empty") input.set(field, "");
      const result = validateLogin(input);
      assert.equal(result.ok, false);
      if (!result.ok)
        assert.equal(
          result.errors[field],
          kind === "missing" || kind === "empty" ? "required" : "invalid",
        );
      assert.ok(!JSON.stringify(result).includes(" x "));
    });
test("login bounds email echoes and password UTF8 bytes", () => {
  for (const email of ["broken", "a".repeat(255) + "@example.test"])
    assert.equal(validateLogin(form(email)).ok, false);
  const result = validateLogin(form("a".repeat(500), "💚".repeat(257)));
  assert.equal(result.ok, false);
  assert.equal(result.values.email.length, 254);
  if (!result.ok) assert.equal(result.errors.password, "tooLong");
  assert.equal(
    validateLogin(form("a@example.test", "💚".repeat(256))).ok,
    true,
  );
});

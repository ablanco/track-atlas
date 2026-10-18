import assert from "node:assert/strict";
import { test } from "node:test";
import { handleSignup, type SignupDependencies } from "../../auth/signup-action";

const input = () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ firstName: " Ada ", lastName: "Lovelace", email: "ada@example.test", dateOfBirth: "1815-12-10", password: "secret-password" })) form.set(key, value);
  return form;
};
const forbidden = () => { throw new Error("must not reach mutation"); };
function dependencies(overrides: Partial<SignupDependencies> = {}): SignupDependencies {
  return { currentUser: async () => null, verifyCaptcha: async () => true, register: forbidden, sendConfirmation: async () => {}, setSession: forbidden, redirectHome: forbidden, ...overrides };
}
test("session outage fails closed with safe values and no password or exception reflection", async () => {
  const result = await handleSignup("en", input(), dependencies({ currentUser: async () => { throw new Error("private SQL/password"); } }));
  assert.equal(result.formError, "unavailable");
  assert.equal(result.values.firstName, "Ada");
  assert.ok(!JSON.stringify(result).includes("secret-password"));
  assert.ok(!JSON.stringify(result).includes("private SQL"));
});
test("unsupported locale rejects without database or external redirect", async () => {
  const result = await handleSignup("https://evil.test", input(), dependencies({ currentUser: forbidden }));
  assert.equal(result.formError, "unavailable");
});
test("authenticated submissions redirect before registration, even with malformed data", async () => {
  const redirected = new Error("redirect");
  await assert.rejects(handleSignup("es", new FormData(), dependencies({ currentUser: async () => ({ userId: "existing", firstName: "Ada", lastName: "Lovelace", displayName: null, avatarFileId: null }), redirectHome: (locale) => { assert.equal(locale, "es"); throw redirected; } })), (error) => error === redirected);
});
test("invalid input returns field errors and bounded safe values without any registration", async () => {
  const form = input(); form.append("email", "second@example.test");
  const result = await handleSignup("en", form, dependencies());
  assert.equal(result.fieldErrors.email, "invalid");
  assert.ok(!JSON.stringify(result).includes("secret-password"));
});
test("duplicate email and service failure never issue a session cookie", async () => {
  for (const reason of ["emailTaken", "unavailable"] as const) {
    const result = await handleSignup("en", input(), dependencies({ register: async () => ({ ok: false, reason }) }));
    assert.equal(reason === "emailTaken" ? result.fieldErrors.email : result.formError, reason);
  }
});

test("failed CAPTCHA prevents registration and returns a safe retry message", async () => {
  const result = await handleSignup("en", input(), dependencies({ verifyCaptcha: async () => false }));
  assert.equal(result.formError, "captcha");
  assert.equal(result.values.firstName, "Ada");
  assert.ok(!JSON.stringify(result).includes("secret-password"));
});

test("CAPTCHA infrastructure failure fails closed before registration", async () => {
  const result = await handleSignup("en", input(), dependencies({ verifyCaptcha: async () => { throw new Error("secret store unavailable"); } }));
  assert.equal(result.formError, "unavailable");
  assert.ok(!JSON.stringify(result).includes("secret store"));
});
test("successful signup issues session before redirect and never swallows redirect", async () => {
  const order: string[] = [];
  const redirected = new Error("redirect");
  const expiresAt = new Date("2026-11-14T00:00:00Z");
  await assert.rejects(handleSignup("en", input(), dependencies({
    verifyCaptcha: async () => { order.push("captcha"); return true; },
    register: async (values) => { assert.equal(values.password, "secret-password"); order.push("register"); return { ok: true, session: { token: "opaque", expiresAt }, confirmation: { userId: "id", email: values.email, firstName: "Ada", purpose: "email-confirmation", token: "A".repeat(43), expiresAt }, confirmationSendAllowed: true }; },
    setSession: async (session) => { assert.deepEqual(session, { token: "opaque", expiresAt }); order.push("cookie"); },
    redirectHome: () => { order.push("redirect"); throw redirected; },
  })), (error) => error === redirected);
  assert.deepEqual(order, ["captcha", "register", "cookie", "redirect"]);
});

test("signup delivery failure cannot undo committed registration or sign-in", async () => {
  const redirected = new Error("redirect"); let cookie = false, attempted = false;
  await assert.rejects(handleSignup("en", input(), dependencies({
    register: async () => ({ ok: true, session: { token: "opaque", expiresAt: new Date() }, confirmation: { userId: "id", email: "ada@example.test", firstName: "Ada", purpose: "email-confirmation", token: "A".repeat(43), expiresAt: new Date() }, confirmationSendAllowed: true }),
    sendConfirmation: async () => { attempted = true; throw Error("provider unavailable"); },
    setSession: async () => { cookie = true; }, redirectHome: () => { throw redirected; },
  })), e => e === redirected);
  assert.equal(cookie, true);
  assert.equal(attempted, true);
});

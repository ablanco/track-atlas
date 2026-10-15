import assert from "node:assert/strict";
import { test } from "node:test";
import { handleLogin, type LoginDependencies } from "../../auth/login-action";

const form = () => { const f = new FormData(); f.set("email", " a@example.test "); f.set("password", "private-password"); return f; };
const forbidden = () => { throw new Error("must not reach effect"); };
const deps = (overrides: Partial<LoginDependencies> = {}): LoginDependencies => ({ verifyCaptcha: async () => true, authenticate: forbidden, setSession: forbidden, ...overrides });
test("login verifies proof before credentials and cookie without returning secrets", async () => {
  const order: string[] = [];
  const result = await handleLogin("es", form(), deps({
    verifyCaptcha: async () => { order.push("captcha"); return true; },
    authenticate: async (input) => { assert.deepEqual(input, { email: "a@example.test", password: "private-password" }); order.push("credentials"); return { ok: true, session: { token: "private-token", expiresAt: new Date() } }; },
    setSession: async ({ token }) => { assert.equal(token, "private-token"); order.push("cookie"); },
  }));
  assert.deepEqual(order, ["captcha", "credentials", "cookie"]); assert.equal(result.success, true);
  assert.ok(!JSON.stringify(result).includes("private-"));
});
test("login rejects bad locale, input, and CAPTCHA before credential work", async () => {
  assert.equal((await handleLogin("https://evil.test", form(), deps({ verifyCaptcha: forbidden }))).formError, "unavailable");
  assert.equal((await handleLogin("en", new FormData(), deps({ verifyCaptcha: forbidden }))).fieldErrors.email, "required");
  assert.equal((await handleLogin("en", form(), deps({ verifyCaptcha: async () => false }))).formError, "captcha");
});
test("credential failure never sets cookie and infrastructure failures are safe", async () => {
  for (const reason of ["invalidCredentials", "unavailable"] as const) assert.equal((await handleLogin("en", form(), deps({ authenticate: async () => ({ ok: false, reason }) }))).formError, reason);
  for (const failure of ["captcha", "credentials", "cookie"]) {
    const result = await handleLogin("en", form(), deps({
      verifyCaptcha: async () => { if (failure === "captcha") throw new Error("private-db"); return true; },
      authenticate: async () => { if (failure === "credentials") throw new Error("private-db"); return { ok: true, session: { token: "secret", expiresAt: new Date() } }; },
      setSession: async () => { throw new Error("private-cookie"); },
    }));
    assert.equal(result.formError, "unavailable"); assert.ok(!JSON.stringify(result).includes("private-"));
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { handleRecoveryRequest, handleResetLink, handleConfirmLink } from "../../auth/account-email-action";
const form = () => { const data = new FormData(); data.set("email", "ada@example.test"); return data; };
test("recovery returns generic safe state for all delivery outcomes", async () => {
  for (const throws of [false, true]) {
    const state = await handleRecoveryRequest("en", form(), { prepare: () => {}, request: async () => { if (throws) throw Error("private account/provider detail"); } });
    assert.deepEqual(state, { values: { email: "ada@example.test" }, fieldErrors: {}, requested: true });
  }
});
test("recovery rejects duplicate and invalid email before effects", async () => {
  const data = form(); data.append("email", "other@example.test");
  const state = await handleRecoveryRequest("en", data, { prepare: () => {}, request: async () => { throw Error("must not run"); } });
  assert.equal(state.fieldErrors.email, "invalid"); assert.equal(state.requested, undefined);
});
test("reset completion survives post-commit cookie failure without reflecting credentials", async () => {
  const data = new FormData(); data.set("token", "A".repeat(43)); data.set("password", "my-new-secret"); data.set("passwordConfirmation", "my-new-secret");
  const state = await handleResetLink("es", data, { reset: async () => ({ ok: true }), clearSession: async () => { throw Error("cookie failure"); }, refresh: () => { throw Error("refresh failure"); } });
  assert.deepEqual(state, { fieldErrors: {}, completed: true });
  assert.ok(!JSON.stringify(state).includes("my-new-secret")); assert.ok(!JSON.stringify(state).includes("A".repeat(43)));
});
test("malformed or duplicate confirmation authority never calls mutation", async () => {
  const data = new FormData(); data.append("token", "A".repeat(43)); data.append("token", "A".repeat(43));
  assert.deepEqual(await handleConfirmLink("en", data, { confirm: async () => { throw Error("must not run"); }, refresh: () => {} }), { formError: "invalid" });
});

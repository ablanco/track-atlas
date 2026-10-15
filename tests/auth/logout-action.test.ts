import assert from "node:assert/strict";
import { test } from "node:test";
import { handleLogout } from "../../auth/logout-action";

test("logout revokes before clearing the cookie and is repeatable", async () => {
  const order: string[] = [];
  for (let i = 0; i < 2; i++) assert.deepEqual(await handleLogout({ revokeCurrent: async () => { order.push("revoke"); }, clearSession: async () => { order.push("clear"); } }), { success: true });
  assert.deepEqual(order, ["revoke", "clear", "revoke", "clear"]);
});
test("logout cannot claim success or clear cookie when revocation fails", async () => {
  let cleared = false;
  const result = await handleLogout({ revokeCurrent: async () => { throw new Error("private SQL"); }, clearSession: async () => { cleared = true; } });
  assert.equal(cleared, false); assert.deepEqual(result, { formError: "unavailable" });
});
test("cookie clearing failure reports unavailable without exception reflection", async () => {
  assert.deepEqual(await handleLogout({ revokeCurrent: async () => {}, clearSession: async () => { throw new Error("private cookie"); } }), { formError: "unavailable" });
});

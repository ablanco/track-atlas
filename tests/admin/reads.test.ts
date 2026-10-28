import assert from "node:assert/strict";
import { test } from "node:test";
import { listAdminRecords } from "../../admin/queries";
test("guests cannot read administration", async () => {
  await assert.rejects(
    listAdminRecords({} as never, undefined, "users", new URLSearchParams()),
    { code: "unauthorized" },
  );
});
import { handleAdminRead } from "../../admin/http";
test("HTTP errors are private and contain only safe codes", async () => {
  const response = await handleAdminRead(
    new Request("http://localhost/api/admin/users"),
    {} as never,
    undefined,
    "users",
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { error: "unauthorized" });
});

import { test, expect } from "./fixtures";
import { readFile } from "node:fs/promises";
test("private capture harness is unavailable to unauthenticated readers", async () => {
  const path = process.env.EMAIL_TEST_METADATA;
  if (!path) throw Error("Capture harness required");
  const sink = JSON.parse(await readFile(path, "utf8"));
  expect((await fetch(sink.url)).status).toBe(403);
  expect((await fetch(sink.url, { headers: { authorization: `Bearer ${sink.token}` } })).status).toBe(200);
});

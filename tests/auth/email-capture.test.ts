import assert from "node:assert/strict";
import { test } from "node:test";
import { startEmailSink } from "../helpers/email-sink";
import { captureEmail } from "../../email/capture";
test("capture sink requires private authorization and keeps messages local", async () => {
  const sink = await startEmailSink();
  try {
    assert.equal((await fetch(sink.url)).status, 403);
    const message = { to: { email: "ada@example.test", name: "Ada" }, subject: "Test", html: "<p>test</p>", text: "test" };
    assert.equal((await captureEmail({ mode: "capture", origin: "http://localhost:3100", rateSecret: "a".repeat(64), directory: "unused", sink }, message)).ok, true);
    const response = await fetch(sink.url, { headers: { authorization: `Bearer ${sink.token}` } });
    assert.deepEqual(await response.json(), [message]);
  } finally { await sink.close(); }
});

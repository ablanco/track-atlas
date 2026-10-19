import assert from "node:assert/strict";
import { test } from "node:test";
import { getEmailConfig } from "../../email/config";
import {
  buildAccountEmailUrl,
  renderAccountEmail,
} from "../../email/templates";
import { sendBrevoEmail } from "../../email/brevo";

const env = {
  NODE_ENV: "development" as const,
  EMAIL_RATE_LIMIT_SECRET: "a".repeat(64),
  APP_ORIGIN: "http://localhost:3000",
};
test("capture cannot run in production and configuration fails closed", () => {
  assert.equal(getEmailConfig(env).mode, "capture");
  assert.throws(() =>
    getEmailConfig({
      ...env,
      NODE_ENV: "production",
      EMAIL_DELIVERY_MODE: "capture",
    }),
  );
  assert.throws(() => getEmailConfig({ ...env, EMAIL_DELIVERY_MODE: "brevo" }));
  assert.throws(() =>
    getEmailConfig({
      ...env,
      EMAIL_TEST_SINK_URL: "https://evil.test",
      EMAIL_TEST_SINK_TOKEN: "secret",
    }),
  );
});
test("origin cannot be controlled by a request", () => {
  assert.equal(
    buildAccountEmailUrl(
      "https://atlas.test",
      "es",
      "password-reset",
      "a".repeat(43),
    ),
    `https://atlas.test/es/reset-password?token=${"a".repeat(43)}`,
  );
  for (const origin of [
    "https://evil.test/path",
    "http://evil.test",
    "https://user:pass@atlas.test",
    "https://atlas.test?next=evil",
  ])
    assert.throws(() => getEmailConfig({ ...env, APP_ORIGIN: origin }));
});
for (const locale of ["en", "es"] as const)
  for (const purpose of ["email-confirmation", "password-reset"] as const)
    test(`renders ${purpose} in ${locale} with literal account text`, () => {
      const message = renderAccountEmail(
        purpose,
        locale,
        "Ada <script>& {{contact.EMAIL}}\r\n",
        "https://atlas.test/link?token=abc&x=1",
      );
      assert.ok(message.html.includes("&lt;script&gt;"));
      assert.ok(!message.html.includes("{{contact."));
      assert.ok(!message.html.includes("<script>"));
      assert.ok(message.html.includes("abc&amp;x=1"));
      assert.ok(message.text.includes("https://atlas.test/link?token=abc&x=1"));
      assert.match(message.text, purpose === "email-confirmation" ? /24/ : /1/);
      assert.ok(message.subject.length > 5);
    });
test("provider accepts one recipient without unsafe names and both alternatives", async () => {
  const config = getEmailConfig({
    ...env,
    EMAIL_DELIVERY_MODE: "brevo",
    BREVO_API_KEY: "private",
    EMAIL_FROM_ADDRESS: "hello@atlas.test",
    EMAIL_FROM_NAME: "Track Atlas",
  });
  assert.equal(config.mode, "brevo");
  if (config.mode !== "brevo") return;
  const result = await sendBrevoEmail(
    config,
    {
      to: { email: "ada@example.test", name: "x".repeat(200) },
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello",
    },
    async (url, init) => {
      assert.equal(url, "https://api.brevo.com/v3/smtp/email");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.to, [{ email: "ada@example.test" }]);
      assert.equal(body.htmlContent, "<p>Hello</p>");
      assert.equal(body.textContent, "Hello");
      assert.equal(body.templateId, undefined);
      assert.equal(body.params, undefined);
      return new Response(JSON.stringify({ messageId: "accepted-id" }), {
        status: 201,
      });
    },
  );
  assert.deepEqual(result, { ok: true, messageId: "accepted-id" });
});
test("provider failures stay private and are never retried", async () => {
  const config = getEmailConfig({
    ...env,
    EMAIL_DELIVERY_MODE: "brevo",
    BREVO_API_KEY: "private",
    EMAIL_FROM_ADDRESS: "hello@atlas.test",
    EMAIL_FROM_NAME: "Track Atlas",
  });
  if (config.mode !== "brevo") throw Error("expected brevo");
  for (const status of [202, 400, 429, 500, 201]) {
    let calls = 0;
    assert.deepEqual(
      await sendBrevoEmail(
        config,
        {
          to: { email: "ada@example.test", name: "Ada" },
          subject: "Hello",
          html: "html",
          text: "text",
        },
        async () => {
          calls++;
          return new Response("private failure", { status });
        },
      ),
      { ok: false, reason: "unavailable" },
    );
    assert.equal(calls, 1);
  }
});
test("provider network and oversized-response failures stay private", async () => {
  const config = getEmailConfig({
    ...env,
    EMAIL_DELIVERY_MODE: "brevo",
    BREVO_API_KEY: "private",
    EMAIL_FROM_ADDRESS: "hello@atlas.test",
    EMAIL_FROM_NAME: "Track Atlas",
  });
  if (config.mode !== "brevo") throw Error("expected brevo");
  const message = {
    to: { email: "ada@example.test", name: "Ada" },
    subject: "Hello",
    html: "html",
    text: "text",
  };
  assert.deepEqual(
    await sendBrevoEmail(config, message, async () => {
      throw Error("private network failure");
    }),
    { ok: false, reason: "unavailable" },
  );
  assert.deepEqual(
    await sendBrevoEmail(
      config,
      message,
      async () =>
        new Response(JSON.stringify({ messageId: "a".repeat(5000) }), {
          status: 201,
        }),
    ),
    { ok: false, reason: "unavailable" },
  );
});
test(
  "provider timeout aborts an in-flight request and returns a safe error",
  { timeout: 7000 },
  async () => {
    const config = getEmailConfig({
      ...env,
      EMAIL_DELIVERY_MODE: "brevo",
      BREVO_API_KEY: "private",
      EMAIL_FROM_ADDRESS: "hello@atlas.test",
      EMAIL_FROM_NAME: "Track Atlas",
    });
    if (config.mode !== "brevo") throw Error("expected brevo");
    const message = {
      to: { email: "ada@example.test", name: "Ada" },
      subject: "Hello",
      html: "html",
      text: "text",
    };
    let aborted = false;
    const result = await sendBrevoEmail(
      config,
      message,
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          const guard = setTimeout(
            () => reject(Error("test request was not aborted")),
            6000,
          );
          init!.signal!.addEventListener(
            "abort",
            () => {
              aborted = true;
              clearTimeout(guard);
              reject(init!.signal!.reason);
            },
            { once: true },
          );
        }),
    );
    assert.deepEqual(result, { ok: false, reason: "unavailable" });
    assert.equal(aborted, true);
  },
);

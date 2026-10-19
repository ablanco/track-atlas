import assert from "node:assert/strict";
import { test } from "node:test";
const baseURL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

test("standalone signup negotiates locale", async () => {
  const response = await fetch(`${baseURL}/signup`, {
    redirect: "manual",
    headers: { "accept-language": "es" },
  });
  assert.equal(response.status, 307);
  assert.equal(
    new URL(response.headers.get("location"), baseURL).pathname,
    "/es/signup",
  );
});
for (const locale of ["en", "es"])
  test(`/${locale}/signup has localized metadata and no reflected credentials`, async () => {
    const response = await fetch(`${baseURL}/${locale}/signup`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(
      html,
      locale === "en" ? /Create your account/ : /Crea tu cuenta/,
    );
    assert.match(html, /<title>/);
    assert.match(html, /name="password"/);
    assert.doesNotMatch(html, /\$scrypt\$/);
  });

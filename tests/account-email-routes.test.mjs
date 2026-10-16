import assert from "node:assert/strict";
import { test } from "node:test";
const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
for (const locale of ["en", "es"]) for (const route of ["confirm-email", "reset-password"]) test(`${locale} ${route} is private, nonindexable and rejects missing links`, async () => {
  const response = await fetch(`${base}/${locale}/${route}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("cache-control"), /no-store/);
  const html = await response.text(); assert.match(html, /noindex/); assert.match(html, /nofollow/);
});

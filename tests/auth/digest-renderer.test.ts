import assert from "node:assert/strict";
import { test } from "node:test";
import { renderDigestEmail } from "../../digests/render";
import { locales } from "../../i18n/locales";
for (const locale of locales)
  test(`bounded grouped literal digest in ${locale}`, () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      uploaderId: "00000000-0000-4000-8000-000000000001",
      displayName: "<script>\n{{contact.EMAIL}}",
      title: "🏔".repeat(200) + "<script>",
      activity: "hiking",
      distanceMeters: 1234,
      ascentMeters: 123,
    }));
    const result = renderDigestEmail({
      locale,
      origin: "https://atlas.test",
      entries,
      total: 100,
      uploaders: [{ id: entries[0].uploaderId, name: "<script>" }],
      token: "a".repeat(43),
    });
    assert.ok(Buffer.byteLength(result.html + result.text) <= 131072);
    assert.equal((result.html.match(/\/tracks\/00000000/g) || []).length, 50);
    assert.equal((result.html.match(/<h2>/g) || []).length, 1);
    assert.ok(!result.html.includes("<script>"));
    assert.ok(!result.html.includes("{{"));
    assert.ok(result.text.includes(`https://atlas.test/${locale}/following`));
    assert.ok(result.text.includes("100"));
    assert.ok(result.text.includes(`/${locale}/digest-opt-out?token=`));
    assert.ok(!result.subject.includes("\n"));
  });

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { escapeHtml, renderedHtml } from "./helpers/html.mjs";
const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
for (const locale of ["en", "es"])
  test(`/${locale} renders product features and working discovery destinations`, async () => {
    const response = await fetch(`${baseUrl}/${locale}`);
    assert.equal(response.status, 200);
    const html = renderedHtml(await response.text());
    const { Home: h } = JSON.parse(
      await readFile(
        new URL(`../messages/${locale}.json`, import.meta.url),
        "utf8",
      ),
    );
    for (const id of ["map-search", "activities", "open-source"])
      assert.ok(html.includes(`id="${id}"`));
    for (const text of [
      h.title,
      h.highlight,
      h.description,
      h.search.approximate,
      h.collection.notice,
      h.openSource.title,
      h.openSource.description,
    ])
      assert.ok(html.includes(escapeHtml(text)), text);
    assert.equal((html.match(/<main\b/g) ?? []).length, 1);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.match(html, /role="tablist"/);
    assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
    assert.ok(html.includes(`href="/${locale}/tracks/upload?login=1"`));
    for (const activity of [
      "hiking",
      "cycling",
      "ski_touring",
      "paddling",
      "horse_riding",
      "four_by_four",
      "other",
    ])
      assert.ok(html.includes(`activity=${activity}`));
    assert.match(html, /href="https:\/\/github.com\/ablanco\/track-atlas"/);
    assert.ok(!html.includes("Planned:"));
    assert.ok(!html.includes("free forever"));
  });

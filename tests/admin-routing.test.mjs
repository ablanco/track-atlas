import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { escapeHtml, renderedHtml } from "./helpers/html.mjs";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const headers = {
  Host: "trackatlas.net",
  "X-Forwarded-Host": "trackatlas.net",
  "X-Forwarded-Proto": "https",
};

for (const locale of ["en", "es", "fr", "pt", "de", "it"]) {
  for (const id of [
    ["f2567440-78d8-4523-9c00-12b0bbbda503"],
    ["track", 0, 6],
  ]) {
    test(`${locale} encoded admin identity ${JSON.stringify(id)} behind TLS termination`, async () => {
      const catalog = JSON.parse(
        await readFile(new URL(`../messages/${locale}.json`, import.meta.url)),
      );
      for (const rsc of [false, true]) {
        const path = `/${locale}/admin/users/${encodeURIComponent(JSON.stringify(id))}?back=${rsc ? encodeURIComponent("page=2&q=test") + "&_rsc" : ""}`;
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { ...headers, ...(rsc ? { RSC: "1" } : {}) },
          redirect: "manual",
        });
        const body = await response.text();
        assert.equal(response.status, 200, body);
        if (!rsc)
          assert.ok(
            renderedHtml(body).includes(escapeHtml(catalog.Admin.access)),
          );
        assert.equal(response.headers.get("location"), null);
        assert.equal(response.headers.get("x-middleware-rewrite"), null);
        assert.match(
          response.headers.get("cache-control"),
          /private.*no-store/,
        );
        assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
      }
    });
  }
  test(`${locale} admin locale redirect preserves encoded identity and query`, async () => {
    const path = `/admin/users/${encodeURIComponent(JSON.stringify(["example"]))}?back=page%3D2`;
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { ...headers, Cookie: `NEXT_LOCALE=${locale}` },
      redirect: "manual",
    });
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location"), baseUrl);
    assert.equal(
      decodeURI(location.pathname),
      `/${locale}/admin/users/["example"]`,
    );
    assert.equal(location.searchParams.get("back"), "page=2");
  });
}

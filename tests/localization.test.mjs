import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { escapeHtml, renderedHtml } from "./helpers/html.mjs";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";

// These boundary tests catch missing routes, incorrect negotiation precedence,
// untranslated output, accidental proxying of assets, and incomplete catalogs.
for (const locale of ["en", "es"]) {
  test(`/${locale} serves localized HTML and metadata`, async () => {
    const response = await fetch(`${baseUrl}/${locale}`, { redirect: "manual" });
    assert.equal(response.status, 200);
    const html = renderedHtml(await response.text());
    assert.match(html, new RegExp(`<html[^>]*lang="${locale}"`));
    const catalog = JSON.parse(
      await readFile(new URL(`../messages/${locale}.json`, import.meta.url)),
    );
    assert.ok([...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].some((match) => match[1] === escapeHtml(catalog.Home.description)));
    assert.ok(html.includes(`<title>${escapeHtml(catalog.Metadata.title)}</title>`));
    assert.ok(
      html.includes(
        `<meta name="description" content="${escapeHtml(catalog.Metadata.description)}"/>`,
      ),
    );
  });
}

for (const { name, headers, pathname } of [
  {
    name: "Spanish browser preference",
    headers: { "Accept-Language": "es" },
    pathname: "/es",
  },
  {
    name: "unsupported browser preference",
    headers: { "Accept-Language": "fr" },
    pathname: "/en",
  },
  { name: "no preference", headers: {}, pathname: "/en" },
  {
    name: "remembered locale before browser preference",
    headers: { Cookie: "NEXT_LOCALE=es", "Accept-Language": "en" },
    pathname: "/es",
  },
]) {
  test(`/ redirects using ${name}`, async () => {
    const response = await fetch(`${baseUrl}/`, { headers, redirect: "manual" });
    assert.equal(response.status, 307, "locale negotiation must use a temporary redirect");
    assert.equal(
      new URL(response.headers.get("location"), baseUrl).pathname,
      pathname,
    );
  });
}

test("explicit /en overrides Spanish cookie and browser preferences", async () => {
  const response = await fetch(`${baseUrl}/en`, {
    headers: { Cookie: "NEXT_LOCALE=es", "Accept-Language": "es" },
    redirect: "manual",
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<html[^>]*lang="en"/);
});

test("unsupported /fr returns 404 without a locale redirect", async () => {
  const response = await fetch(`${baseUrl}/fr`, { redirect: "manual" });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("location"), null);
});

test("/next.svg remains an unredirected SVG asset", async () => {
  const response = await fetch(`${baseUrl}/next.svg`, { redirect: "manual" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(await response.text(), /<svg/);
});

function messageKeys(value, prefix = "") {
  assert.equal(
    typeof value,
    "object",
    `${prefix || "catalog"} must contain messages`,
  );
  assert.ok(value !== null && !Array.isArray(value));
  assert.ok(
    Object.keys(value).length > 0,
    `${prefix || "catalog"} must not be empty`,
  );
  return Object.entries(value)
    .flatMap(([key, message]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof message === "object") return messageKeys(message, path);
      assert.equal(typeof message, "string", `${path} must be a string`);
      assert.ok(message.trim().length > 0, `${path} must not be empty`);
      return [path];
    })
    .sort();
}

test("English and Spanish catalogs have matching nonempty recursive message keys", async () => {
  const catalogs = await Promise.all(
    ["en", "es"].map(async (locale) => {
      const url = new URL(`../messages/${locale}.json`, import.meta.url);
      const text = await readFile(url, "utf8").catch((error) => {
        if (error.code === "ENOENT") return "{}";
        throw error;
      });
      return JSON.parse(text);
    }),
  );
  for (const catalog of catalogs) {
    assert.deepEqual(Object.keys(catalog).sort(), ["Home", "Metadata", "Navigation", "Signup", "Theme"]);
  }
  assert.deepEqual(messageKeys(catalogs[0]), messageKeys(catalogs[1]));
});

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { renderedHtml } from "./helpers/html.mjs";

const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
for (const locale of ["en", "es"]) {
  test(`public ${locale} terms explain ownership, visibility and safety`, async () => {
    const response = await fetch(`${base}/${locale}/legal/terms`, {
      redirect: "manual",
    });
    assert.equal(response.status, 200);
    const html = renderedHtml(await response.text());
    assert.match(html, new RegExp(`<html[^>]*lang="${locale}"`));
    for (const text of [
      "Alejandro Blanco",
      "Calle Victoria Kent, 1.",
      "info@trackatlas.net",
      "privacy@trackatlas.net",
      "GPX",
      "18",
    ])
      assert.ok(html.includes(text), text);
    assert.match(html, /<main[^>]*id="main-content"/);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.ok(
      html.includes(
        locale === "en"
          ? "Downloaded copies cannot be recalled"
          : "Las copias descargadas no pueden recuperarse",
      ),
    );
  });
}

for (const locale of ["en", "es"]) {
  test(`public ${locale} privacy discloses actual processing and manual rights requests`, async () => {
    const response = await fetch(`${base}/${locale}/legal/privacy`, {
      redirect: "manual",
    });
    assert.equal(response.status, 200);
    const html = renderedHtml(await response.text());
    for (const text of [
      "Alejandro Blanco",
      "privacy@trackatlas.net",
      "DigitalOcean",
      "Amsterdam",
      "Cloudflare",
      "Backblaze",
      "eu-central-003",
      "Brevo",
      "OpenFreeMap",
      "OpenTopoMap",
      "Mapbox",
      "GPX Studio",
      "AEPD",
      "ALTCHA",
    ])
      assert.ok(html.includes(text), text);
    assert.ok(
      html.includes(
        locale === "en" ? "legitimate interests" : "intereses legítimos",
      ),
    );
    assert.ok(
      html.includes(
        locale === "en"
          ? "Deactivation is not erasure"
          : "La desactivación no es una supresión",
      ),
    );
    assert.ok(html.includes('href="mailto:privacy@trackatlas.net"'));
    assert.ok(html.includes('href="https://www.aepd.es/"'));
    assert.ok(html.includes("track_atlas_upload_intent"));
    assert.ok(
      html.includes(locale === "en" ? "session cookie" : "cookie de sesión"),
    );
  });
}

for (const locale of ["en", "es"]) {
  for (const document of ["terms", "privacy"]) {
    test(`${locale} ${document} revision is permanently retrievable with identical legal text`, async () => {
      const current = await fetch(`${base}/${locale}/legal/${document}`);
      const currentHtml = await current.text();
      const version = currentHtml.match(
        new RegExp(`href="/${locale}/legal/${document}/([^"/]+)"`),
      )?.[1];
      assert.ok(version);
      const archived = await fetch(
        `${base}/${locale}/legal/${document}/${version}`,
      );
      assert.equal(archived.status, 200);
      const body = (html) => {
        const text = renderedHtml(html).match(
          /<div data-legal-text="true">([\s\S]*?)<\/article>/,
        )?.[1];
        assert.ok(text);
        return [
          ...text.matchAll(/<(?:h2|p)\b[^>]*>([\s\S]*?)<\/(?:h2|p)>/g),
        ].map((match) => match[1]);
      };
      const archivedHtml = await archived.text();
      assert.ok(body(currentHtml));
      assert.deepEqual(body(archivedHtml), body(currentHtml));
      assert.ok(
        currentHtml.includes(`href="/${locale}/legal/${document}/${version}"`),
      );
      assert.ok(archivedHtml.includes(`href="/${locale}/legal/${document}"`));
    });
  }
}

test("unknown documents and revisions never fall back to current legal text", async () => {
  for (const path of [
    "other",
    "terms/unknown",
    "privacy/2025-01-01",
    "terms/2026-11-03/extra",
  ]) {
    const response = await fetch(`${base}/en/legal/${path}`, {
      redirect: "manual",
    });
    // Next streams not-found pages: the public signal is noindex plus no legal document.
    const html = renderedHtml(await response.text());
    assert.ok(
      response.status === 404 ||
        (response.status === 200 && html.includes('content="noindex"')),
    );
    assert.ok(!html.includes("data-legal-text"));
  }
});

for (const [locale, document, title] of [
  ["en", "terms", "Terms and Conditions"],
  ["es", "privacy", "Política de privacidad"],
]) {
  test(`${locale} ${document} has document-specific localized metadata`, async () => {
    const response = await fetch(`${base}/${locale}/legal/${document}`);
    assert.ok(
      (await response.text()).includes(`<title>${title} · Track Atlas</title>`),
    );
  });
}

// Frozen published text, independent of whichever revision is current later.
const revisionDigests = JSON.parse(
  await readFile(
    new URL("./fixtures/legal-revision-digests.json", import.meta.url),
    "utf8",
  ),
);
for (const [path, digest] of Object.entries(revisionDigests)) {
  const [locale, document, version] = path.split("/");
  test(`published ${path} legal text remains immutable`, async () => {
    const response = await fetch(
      `${base}/${locale}/legal/${document}/${version}`,
    );
    assert.equal(response.status, 200);
    const html = renderedHtml(await response.text());
    const legalText = html.match(
      /<div data-legal-text="true">([\s\S]*?)<\/article>/,
    )?.[1];
    assert.ok(legalText);
    const texts = [
      ...legalText.matchAll(/<(?:h2|p)\b[^>]*>([\s\S]*?)<\/(?:h2|p)>/g),
    ].map((match) => match[1]);
    assert.equal(
      createHash("sha256")
        .update(
          JSON.stringify([
            html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1],
            ...texts,
          ]),
        )
        .digest("hex"),
      digest,
    );
  });
}

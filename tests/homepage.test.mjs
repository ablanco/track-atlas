import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { escapeHtml, renderedHtml } from "./helpers/html.mjs";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";

// Catch missing rendered sections, misleading availability and unusable links.
for (const locale of ["en", "es"]) {
  test(`/${locale} renders the complete, honest homepage and navigation`, async () => {
    const response = await fetch(`${baseUrl}/${locale}`);
    assert.equal(response.status, 200);
    const html = renderedHtml(await response.text());
    const {
      Home: home,
      Navigation: nav,
      Metadata: meta,
    } = JSON.parse(
      await readFile(
        new URL(`../messages/${locale}.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.match(html, /<section[^>]*id="discover"/);
    for (const id of ["how-it-works", "your-collection", "open-source"]) {
      assert.ok(html.includes(`id="${id}"`), `missing ${id}`);
    }
    for (const text of [
      home.title,
      home.description,
      home.notice,
      home.mapDisclosure,
      home.discover.title,
      home.how.title,
      home.collection.title,
      home.collection.notice,
      home.openSource.description,
      nav.skip,
    ]) {
      assert.equal(typeof text, "string");
      assert.ok(
        html.includes(escapeHtml(text)),
        `missing visible copy: ${text}`,
      );
    }
    assert.equal((html.match(/<main\b/g) ?? []).length, 1);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    const heroHeading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1];
    assert.equal(heroHeading, escapeHtml(home.title));
    for (const [id, content] of [
      ["discover", home.discover],
      ["how-it-works", home.how],
      ["your-collection", home.collection],
    ]) {
      const section = html.match(
        new RegExp(`<section[^>]*id="${id}"[^>]*>([\\s\\S]*?)</section>`),
      )?.[1];
      assert.ok(section);
      for (const item of Object.values(content).filter(
        (value) => typeof value === "object",
      )) {
        assert.ok(section.includes(escapeHtml(item.title)));
        assert.ok(section.includes(escapeHtml(item.description)));
      }
    }
    assert.match(html, /<main[^>]*id="main-content"[^>]*tabindex="-1"/);
    assert.match(html, /<a[^>]*href="#main-content"/);
    assert.ok(html.includes(`<title>${escapeHtml(meta.title)}</title>`));
    assert.ok(html.includes(`content="${escapeHtml(meta.description)}"`));
    assert.match(html, /href="https:\/\/github.com\/ablanco\/track-atlas"/);
    const githubLinks = [
      ...html.matchAll(
        /<a\b[^>]*href="https:\/\/github.com\/ablanco\/track-atlas"[^>]*>([\s\S]*?)<\/a>/g,
      ),
    ];
    assert.equal(githubLinks.length, 2);
    for (const [, content] of githubLinks) {
      assert.match(content, /<svg\b[^>]*aria-hidden="true"/);
      assert.match(content, /<path\b[^>]*d="[^"]+"/);
      assert.ok(
        !content.includes("↗"),
        "GitHub links should not include arrow glyphs",
      );
    }
    const brandLink = html.match(
      /<header\b[^>]*>[\s\S]*?<a\b[^>]*aria-label="[^"]+"[^>]*>([\s\S]*?)<\/a>/,
    )?.[1];
    const footerBrand = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].find(
      (match) =>
        match[1].trimStart().startsWith("<svg") &&
        match[1].includes("Track Atlas"),
    )?.[1];
    for (const brand of [brandLink, footerBrand]) {
      assert.ok(brand?.includes("Track Atlas"));
      assert.match(brand, /<svg\b[^>]*aria-hidden="true"/);
      assert.ok(
        !brand.includes("↗"),
        "Track Atlas branding should use an SVG instead of an arrow glyph",
      );
    }
    for (const language of ["en", "es"]) {
      assert.match(
        html,
        new RegExp(
          `<link[^>]*hrefLang="${language}"[^>]*href="/${language}"`,
          "i",
        ),
      );
      assert.ok(
        [...html.matchAll(/<a\b[^>]*>/g)].some(
          ([tag]) =>
            tag.includes(`href="/${language}"`) &&
            tag.includes(`lang="${language}"`) &&
            (language !== locale || tag.includes('aria-current="page"')),
        ),
      );
    }
    const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
    assert.equal(
      buttons.length,
      2,
      "Only theme switching and login should be offered",
    );
    const login = buttons.find(([tag]) =>
      tag.includes('aria-haspopup="dialog"'),
    );
    assert.ok(login);
    assert.equal(login[1], locale === "en" ? "Log in" : "Iniciar sesión");
    const theme = buttons.find(([tag]) => tag.includes('role="switch"'));
    assert.ok(theme);
    assert.match(theme[0], /aria-checked="false"/);
    assert.match(theme[0], /disabled=""/);
    assert.ok(
      theme[0].includes(`aria-label="${locale === "en" ? "Theme" : "Tema"}"`),
    );
    assert.ok(
      html.includes(`href="/${locale}/tracks"`),
      "Public explorer navigation must be available",
    );
    for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
      assert.ok(
        [
          "/en",
          "/es",
          "/en/signup",
          "/es/signup",
          "/en/tracks",
          "/es/tracks",
          `/${locale}#discover`,
          `/${locale}#how-it-works`,
          "https://github.com/ablanco/track-atlas",
        ].includes(href) || href.startsWith("#"),
        href,
      );
    }
  });
}

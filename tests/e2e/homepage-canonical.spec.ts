import { test, expect } from "./fixtures";
import { locales } from "../../i18n/locales";

const enabled = process.env.SEO_INDEXING_ENABLED === "true";
const agents = [
  ["ordinary HTML consumer", "Mozilla/5.0"],
  ["search crawler", "Googlebot"],
  ["HTML-limited crawler", "Twitterbot/1.0"],
] as const;
const regions = {
  en: "en_US",
  es: "es_ES",
  fr: "fr_FR",
  pt: "pt_PT",
  de: "de_DE",
  it: "it_IT",
};
const publicOrigin = (baseURL: string) =>
  process.env.E2E_SERVER_MODE === "production"
    ? baseURL.replace("http:", "https:")
    : baseURL;

for (const locale of locales) {
  for (const [consumer, userAgent] of agents) {
    test(`${locale} homepage canonical is available without JavaScript to ${consumer}`, async ({
      browser,
      baseURL,
    }) => {
      const origin = publicOrigin(baseURL!);
      const crawler = await browser.newContext({
        javaScriptEnabled: false,
        userAgent,
      });
      try {
        const page = await crawler.newPage();
        for (const query of ["", "?utm_source=test&tag=one&tag=two"]) {
          const response = await page.goto(`${baseURL}/${locale}${query}`);
          expect(response!.status()).toBe(200);
          const indexable = enabled && !query;
          expect(response!.headers()["x-robots-tag"]).toBe(
            indexable ? undefined : "noindex, nofollow",
          );
          // Check actual parsed HTML without hydration, and uniqueness across the
          // whole document so a second streamed canonical cannot go unnoticed.
          await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
          await expect(
            page.locator('head link[rel="canonical"]'),
          ).toHaveAttribute("href", `${origin}/${locale}`);
          await expect(
            page.locator('head meta[name="robots"]'),
          ).toHaveAttribute(
            "content",
            indexable ? "index, follow" : "noindex, nofollow",
          );
          await expect(
            page.locator('head link[rel="alternate"][hreflang]'),
          ).toHaveCount(6);
          for (const language of locales)
            await expect(
              page.locator(`head link[hreflang="${language}"]`),
            ).toHaveAttribute("href", `${origin}/${language}`);
          await expect(
            page.locator('head meta[property="og:url"]'),
          ).toHaveAttribute("content", `${origin}/${locale}`);
          await expect(
            page.locator('head meta[property="og:locale"]'),
          ).toHaveAttribute("content", regions[locale]);
          await expect(
            page.locator('head meta[name="twitter:card"]'),
          ).toHaveAttribute("content", "summary_large_image");
          await expect(
            page.locator('head meta[property="og:image"]'),
          ).toHaveAttribute(
            "content",
            `${origin}/images/track-atlas-preview.jpg`,
          );
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        }
      } finally {
        await crawler.close();
      }
    });
  }

  test(`${locale} homepage canonical ignores hostile origin headers`, async ({
    request,
    baseURL,
  }) => {
    const response = await request.get(`/${locale}?utm_source=test`, {
      headers: {
        host: "host.attacker.invalid",
        "x-forwarded-host": "forwarded.attacker.invalid",
        "x-forwarded-proto": "http",
        forwarded: 'host="forwarded.attacker.invalid";proto=http',
      },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    const html = await response.text();
    const head = html.split("</head>")[0];
    expect(html.match(/<link\b[^>]*\brel="canonical"[^>]*>/g)).toHaveLength(1);
    expect(head).toContain(
      `rel="canonical" href="${publicOrigin(baseURL!)}/${locale}"`,
    );
    expect(head).not.toContain("attacker.invalid");
  });
}

test("homepage sitemap URLs agree with rendered canonical URLs", async ({
  request,
  baseURL,
}) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  if (enabled) {
    for (const locale of locales)
      expect(xml).toContain(`<loc>${publicOrigin(baseURL!)}/${locale}</loc>`);
  } else {
    expect(xml).not.toContain("<loc>");
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /");
    expect(robots).not.toContain("Sitemap:");
  }
});

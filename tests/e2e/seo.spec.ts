import sharp from "sharp";
import { test, expect, selectTheme } from "./fixtures";

const enabled = process.env.SEO_INDEXING_ENABLED === "true";
for (const locale of ["en", "es"]) {
  test(`${locale} homepage exposes localized crawler metadata and retains themes`, async ({
    page,
    request,
    baseURL,
  }) => {
    test.skip(!enabled, "Run opt-in coverage with SEO_INDEXING_ENABLED=true");
    const response = await request.get(`/${locale}`, {
      headers: { "User-Agent": "Twitterbot/1.0" },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["x-robots-tag"]).toBe("index, follow");
    const html = await response.text();
    expect(html).toContain(`rel="canonical" href="${baseURL}/${locale}"`);
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain("application/ld+json");
    await page.goto(`/${locale}`);
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
      "content",
      locale === "en" ? "en_US" : "es_ES",
    );
    await selectTheme(page, "dark");
    await selectTheme(page, "light");
  });
}

import { Pool } from "pg";
import { loadEnvConfig } from "@next/env";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { acceptFixtureDocuments } from "../helpers/legal-evidence";
import { stubBasemap } from "../helpers/map";
loadEnvConfig(process.cwd(), true);
const dbUrl = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(dbUrl.hostname))
  throw Error("SEO fixtures require a local development DB");
const pool = new Pool({ connectionString: dbUrl.href });
test.afterAll(() => pool.end());

test("public Track metadata uses anonymous authority and current text", async ({
  context,
  request,
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const token = randomBytes(32).toString("base64url");
  const {
    rows: [owner],
  } = await pool.query(
    "INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth,email_confirmed) VALUES('SEO','Fixture',$1,'synthetic','1990-01-01',true) RETURNING id",
    [`seo-${randomUUID()}@example.test`],
  );
  try {
    await acceptFixtureDocuments(pool, owner.id);
    await pool.query(
      "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
      [owner.id, createHash("sha256").update(token).digest("hex")],
    );
    await context.addCookies([
      {
        name: "track_atlas_session",
        value: token,
        url: baseURL!,
        httpOnly: true,
      },
    ]);
    const metadata = {
      name: "Ridge </script><script>alert(1)</script> & snow",
      description: "First line\n\n  Second line " + "Long text. ".repeat(40),
      activity: "hiking",
      difficulty: 3,
      tags: [],
      visibility: "public",
    };
    const created = await context.request.post("/api/tracks", {
      headers: { origin: baseURL! },
      multipart: {
        ...metadata,
        difficulty: "3",
        tags: "[]",
        requestId: randomUUID(),
        file: {
          name: "seo.gpx",
          mimeType: "application/gpx+xml",
          buffer: Buffer.from(
            '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="40" lon="-3"/><trkpt lat="40.1" lon="-3.1"/></trkseg></trk></gpx>',
          ),
        },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = await created.json();
    await stubBasemap(page);
    for (const locale of ["en", "es"]) {
      const response = await request.get(`/${locale}/tracks/${id}`, {
        headers: { "User-Agent": "Twitterbot/1.0" },
      });
      expect(response.headers()["x-robots-tag"]).toBe(
        enabled ? "index, follow" : "noindex, nofollow",
      );
      const html = await response.text();
      expect(html).toContain(
        "Ridge &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; snow — Track Atlas</title>",
      );
      expect(html).toContain(
        `rel="canonical" href="${baseURL}/${locale}/tracks/${id}"`,
      );
      expect(html).toContain("First line Second line Long text.");
      expect(html).toContain("application/ld+json");
      expect(html).toContain("/images/track-atlas-preview.jpg");
      await page.goto(`/${locale}/tracks/${id}`);
      const description = await page
        .locator('meta[name="description"]')
        .getAttribute("content");
      expect(description!.length).toBeLessThanOrEqual(200);
      expect(description).toMatch(/…$/);
      expect(description).not.toMatch(/\n| {2}/);
      const structured = await page
        .locator('script[type="application/ld+json"]')
        .textContent();
      expect(JSON.parse(structured!).name).toBe(metadata.name);
      await expect(
        page.getByRole("heading", { name: metadata.name, exact: true }),
      ).toBeVisible();
    }
    const edit = async (fields: object) => {
      const response = await context.request.patch(`/api/tracks/${id}`, {
        headers: { origin: baseURL! },
        data: { ...metadata, ...fields },
      });
      expect(response.status(), await response.text()).toBe(200);
    };
    const photoIds: string[] = [];
    for (const color of ["blue", "green"]) {
      const bytes = await sharp({
        create: { width: 60, height: 40, channels: 3, background: color },
      })
        .jpeg()
        .withMetadata()
        .toBuffer();
      const uploaded = await context.request.post("/api/files?purpose=photo", {
        headers: { origin: baseURL!, "content-type": "image/jpeg" },
        data: bytes,
      });
      expect(uploaded.status(), await uploaded.text()).toBe(201);
      photoIds.push((await uploaded.json()).id);
    }
    const preview = (photoId: string) =>
      `${baseURL}/api/tracks/${id}/photos/${photoId}?size=large&format=jpeg`;
    const assertPreview = async (photoId: string) => {
      await page.goto(`/en/tracks/${id}`);
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
        "content",
        preview(photoId),
      );
      const response = await request.get(preview(photoId));
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/jpeg");
      expect(response.headers()["cache-control"]).toContain("no-store");
      const info = await sharp(await response.body()).metadata();
      expect(info.exif).toBeUndefined();
      expect(info.width! / info.height!).toBe(1.5);
    };
    await edit({ photos: photoIds.map((id) => ({ id, caption: "Photo" })) });
    await assertPreview(photoIds[0]);
    await edit({
      photos: photoIds.toReversed().map((id) => ({ id, caption: "Photo" })),
    });
    await assertPreview(photoIds[1]);
    await edit({
      visibility: "private",
      photos: photoIds.toReversed().map((id) => ({ id, caption: "Photo" })),
    });
    expect((await request.get(preview(photoIds[1]))).status()).toBe(404);
    await edit({
      photos: photoIds.toReversed().map((id) => ({ id, caption: "Photo" })),
    });
    await pool.query("UPDATE users SET active=false WHERE id=$1", [owner.id]);
    const inactive = await request.get(`/en/tracks/${id}`);
    expect(inactive.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(await inactive.text()).not.toContain('property="og:title"');
    expect((await request.get(preview(photoIds[1]))).status()).toBe(404);
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain(id);
    await pool.query("UPDATE users SET active=true WHERE id=$1", [owner.id]);
    await edit({ photos: [] });
    await page.goto(`/es/tracks/${id}`);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      `${baseURL}/images/track-atlas-preview.jpg`,
    );
    expect((await request.get(preview(photoIds[0]))).status()).toBe(404);
    const xml = await (await request.get("/sitemap.xml")).text();
    if (enabled) {
      expect(xml).toContain(`<loc>${baseURL}/en/tracks/${id}</loc>`);
      expect(xml).toContain(`<loc>${baseURL}/es/tracks/${id}</loc>`);
    } else expect(xml).not.toContain(id);
    await edit({ name: "Updated ridge", description: "Updated description" });
    expect(await (await request.get(`/en/tracks/${id}`)).text()).toContain(
      "Updated ridge — Track Atlas</title>",
    );
    await edit({ visibility: "private" });
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain(id);
    for (const admin of [false, true]) {
      await pool.query("UPDATE users SET admin=$1 WHERE id=$2", [
        admin,
        owner.id,
      ]);
      for (const client of [request, context.request]) {
        const response = await client.get(`/en/tracks/${id}`, {
          headers: { "User-Agent": "Twitterbot/1.0" },
        });
        expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
        const html = await response.text();
        expect(html).not.toContain('property="og:title"');
        expect(html).not.toContain("application/ld+json");
        expect(html).not.toContain(
          "Ridge &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; snow — Track Atlas</title>",
        );
      }
    }
    expect(
      (
        await context.request.delete(`/api/tracks/${id}`, {
          headers: { origin: baseURL! },
        })
      ).status(),
    ).toBe(204);
    const deleted = await request.get(`/es/tracks/${id}`);
    expect(deleted.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(await deleted.text()).not.toContain('property="og:title"');
  } finally {
    const client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      "UPDATE track_photos SET track_id=NULL WHERE track_id IN (SELECT id FROM tracks WHERE owner_id=$1)",
      [owner.id],
    );
    await client.query("DELETE FROM track_upload_attempts WHERE owner_id=$1", [
      owner.id,
    ]);
    await client.query("DELETE FROM tracks WHERE owner_id=$1", [owner.id]);
    await client.query("DELETE FROM stored_files WHERE owner_id=$1", [
      owner.id,
    ]);
    await client.query("DELETE FROM users WHERE id=$1", [owner.id]);
    await client.query("COMMIT");
    client.release();
  }
});

test("discovery endpoints and duplicate URLs agree on indexability", async ({
  request,
  baseURL,
}) => {
  test.skip(!enabled, "Run opt-in coverage with SEO_INDEXING_ENABLED=true");
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Allow: /");
  expect(await robots.text()).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain(`<loc>${baseURL}/en</loc>`);
  expect(xml).toContain(`<loc>${baseURL}/es</loc>`);
  expect(xml).toContain('hreflang="es"');
  for (const path of [
    "/en?filter=anything",
    "/en/tracks",
    "/es/settings",
    "/en/tracks/invalid",
  ]) {
    const response = await request.get(path);
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  }
});

test("default deployment excludes pages and advertises no sitemap while resources work", async ({
  request,
  baseURL,
}) => {
  test.skip(enabled, "Run default-off coverage without SEO_INDEXING_ENABLED");
  for (const locale of ["en", "es"]) {
    const response = await request.get(`/${locale}`, {
      headers: { "User-Agent": "Bingbot" },
    });
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(await response.text()).toContain(
      'name="robots" content="noindex, nofollow"',
    );
  }
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /");
  expect(robots).not.toContain("Sitemap:");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("<loc>");
  const image = await request.get(`${baseURL}/images/track-atlas-preview.jpg`);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/jpeg");
});

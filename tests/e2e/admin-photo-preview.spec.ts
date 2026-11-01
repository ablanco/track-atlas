import { test, expect, selectTheme, expectTheme } from "./fixtures";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import sharp from "sharp";

loadEnvConfig(process.cwd(), true);
for (const locale of ["en", "es"] as const)
  for (const theme of ["light", "dark"] as const)
    test(`${locale} ${theme} admin photo preview decodes and enforces access`, async ({
      page,
      context,
      request,
      baseURL,
    }) => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const token = randomBytes(32).toString("base64url");
      let userId = "";
      try {
        userId = (
          await pool.query(
            "INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth,admin,email_confirmed) VALUES ('Photo','Admin',$1,'synthetic','1990-01-01',true,true) RETURNING id",
            [`admin-photo-${randomUUID()}@example.test`],
          )
        ).rows[0].id;
        await pool.query(
          "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
          [userId, createHash("sha256").update(token).digest("hex")],
        );
        await context.addCookies([
          { name: "track_atlas_session", value: token, url: baseURL! },
        ]);
        const bytes = await sharp({
          create: {
            width: 800,
            height: 600,
            channels: 3,
            background: "#187060",
          },
        })
          .png()
          .toBuffer();
        const upload = await context.request.post("/api/files?purpose=photo", {
          data: bytes,
          headers: {
            origin: new URL(baseURL!).origin,
            "content-type": "image/png",
          },
        });
        expect(upload.status()).toBe(201);
        const photoId = (
          await pool.query(
            "SELECT id FROM stored_files WHERE owner_id=$1 AND purpose='photo'",
            [userId],
          )
        ).rows[0].id;
        const endpoint = `/api/admin/photos/${photoId}/preview`;
        expect((await request.get(endpoint)).status()).toBe(401);
        const preview = await context.request.get(endpoint);
        expect(preview.status()).toBe(200);
        expect(preview.headers()["content-type"]).toBe("image/webp");
        expect(preview.headers()["cache-control"]).toContain("no-store");
        expect(preview.headers()["x-content-type-options"]).toBe("nosniff");
        const metadata = await sharp(await preview.body()).metadata();
        expect(metadata.width).toBe(480);
        expect(metadata.height).toBe(360);
        await page.goto(
          `/${locale}/admin/track_photos/${encodeURIComponent(JSON.stringify([photoId]))}`,
        );
        await selectTheme(page, theme);
        await expectTheme(page, theme);
        const image = page.getByRole("img", {
          name: locale === "en" ? "Photo preview" : "Vista previa de la foto",
          exact: true,
        });
        await expect(image).toBeVisible();
        await expect
          .poll(() =>
            image.evaluate((element: HTMLImageElement) => element.naturalWidth),
          )
          .toBe(480);
        await expect(
          page.getByRole("link", {
            name: locale === "en" ? "Download original" : "Descargar original",
          }),
        ).toBeVisible();
        await pool.query(
          "UPDATE stored_files SET status='deleting', delete_after=now()+interval '24 hours' WHERE id=$1",
          [photoId],
        );
        expect((await context.request.get(endpoint)).status()).toBe(404);
        await page.reload();
        await expect(
          page.getByText(
            locale === "en"
              ? "Preview unavailable."
              : "Vista previa no disponible.",
            { exact: true },
          ),
        ).toBeVisible();
        await pool.query("UPDATE users SET admin=false WHERE id=$1", [userId]);
        expect((await context.request.get(endpoint)).status()).toBe(403);
      } finally {
        if (userId) {
          await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [
            userId,
          ]);
          await pool.query("DELETE FROM users WHERE id=$1", [userId]);
        }
        await pool.end();
      }
    });

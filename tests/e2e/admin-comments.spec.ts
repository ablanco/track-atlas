import { test, expect, selectTheme } from "./fixtures";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { randomBytes, randomUUID, createHash } from "node:crypto";
loadEnvConfig(process.cwd(), true);
for (const locale of ["en", "es"] as const) {
  test(`admin discussion moderation preserves plain text and shows lifecycle consequences (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    if (
      !process.env.DATABASE_URL ||
      !["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(process.env.DATABASE_URL).hostname,
      )
    )
      throw Error("Loopback development database required");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const token = randomBytes(32).toString("base64url");
    let user = "";
    try {
      user = (
        await pool.query(
          "INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth,admin,email_confirmed) VALUES('Admin','Browser',$1,'synthetic','1990-01-01',true,true) RETURNING id",
          [`admin-comments-${randomUUID()}@example.test`],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [user, createHash("sha256").update(token).digest("hex")],
      );
      await context.addCookies([
        { name: "track_atlas_session", value: token, url: baseURL! },
      ]);
      const upload = await context.request.post("/api/tracks", {
        headers: { origin: baseURL! },
        multipart: {
          requestId: randomUUID(),
          name: "Admin private track",
          description: "Test",
          activity: "hiking",
          difficulty: "1",
          tags: "[]",
          visibility: "private",
          file: {
            name: "track.gpx",
            mimeType: "application/gpx+xml",
            buffer: Buffer.from(
              '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test"><trk><trkseg><trkpt lat="40" lon="-3"/><trkpt lat="40.001" lon="-3.001"/></trkseg></trk></gpx>',
            ),
          },
        },
      });
      expect(upload.status()).toBe(201);
      const track = (await upload.json()).id;
      const comment = (
        await pool.query(
          "INSERT INTO track_comments(track_id,author_id,text) VALUES($1,$2,'First line'||chr(10)||'<b>plain</b>') RETURNING id",
          [track, user],
        )
      ).rows[0].id;
      const reply = (
        await pool.query(
          "INSERT INTO track_comment_replies(comment_id,author_id,text) VALUES($1,$2,'Answer') RETURNING id",
          [comment, user],
        )
      ).rows[0].id;
      const en = locale === "en";
      const commentName = en ? "Track comments" : "Comentarios de rutas";
      const replyName = en ? "Owner replies" : "Respuestas del propietario";
      const textLabel = en ? "Text" : "Texto";
      const id = (v: string) => encodeURIComponent(JSON.stringify([v]));
      await page.goto(`/${locale}/admin/track_comments?track_id=${track}`);
      await expect(
        page.getByRole("heading", { name: commentName, exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("navigation", {
            name: en ? "Browse models" : "Explorar modelos",
          })
          .getByRole("link", { name: replyName, exact: true }),
      ).toBeVisible();
      await page
        .getByRole("link", { name: en ? "Details" : "Detalles", exact: true })
        .click();
      const text = page.getByRole("textbox", { name: textLabel, exact: true });
      await expect(text).toHaveJSProperty("tagName", "TEXTAREA");
      await expect(text).toHaveValue("First line\n<b>plain</b>");
      await expect(
        page.locator(
          'input[name="author_id"],input[name="track_id"],input[name="created_at"]',
        ),
      ).toHaveCount(0);
      await text.fill("Revised\n<script>literal</script> 😀");
      await page
        .getByRole("button", {
          name: en ? "Review changes" : "Revisar cambios",
        })
        .click();
      await expect(page.getByRole("dialog")).toContainText(
        en ? "Only the text changes" : "Solo cambia el texto",
      );
      await page
        .getByRole("button", {
          name: en ? "Confirm changes" : "Confirmar cambios",
          exact: true,
        })
        .click();
      await expect(text).toHaveValue("Revised\n<script>literal</script> 😀");
      await expect(page.locator("dl").first()).toContainText(
        "Revised\n<script>literal</script> 😀",
      );
      await selectTheme(page, "dark");
      await page.goto(`/${locale}/admin/track_comment_replies/${id(reply)}`);
      await expect(
        page.getByRole("textbox", { name: textLabel, exact: true }),
      ).toHaveValue("Answer");
      await expect(
        page.locator(
          `dl a[href="/${locale}/admin/track_comments/${id(comment)}"]`,
        ),
      ).toBeVisible();
      await page
        .getByRole("button", { name: en ? "Delete" : "Eliminar", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toContainText(
        en
          ? "The track owner may reply again"
          : "El propietario de la ruta podrá responder de nuevo",
      );
      await page
        .getByRole("button", {
          name: en ? "Confirm changes" : "Confirmar cambios",
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/admin/track_comment_replies$`),
      );
      await page.goto(`/${locale}/admin/track_comments?track_id=${track}`);
      await page
        .getByRole("checkbox", {
          name: en ? "Select current page" : "Seleccionar página actual",
        })
        .check();
      await page
        .getByRole("button", { name: en ? "Delete" : "Eliminar", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toContainText(
        en
          ? "comments and their owner replies"
          : "comentarios y las respuestas de sus propietarios",
      );
      await page
        .getByRole("button", {
          name: en ? "Confirm changes" : "Confirmar cambios",
          exact: true,
        })
        .click();
      await expect(page.getByRole("row")).toHaveCount(1);
      await selectTheme(page, "light");
    } finally {
      if (user) {
        await pool.query("DELETE FROM tracks WHERE owner_id=$1", [user]);
        await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [user]);
        await pool.query("DELETE FROM users WHERE id=$1", [user]);
      }
      await pool.end();
    }
  });
}

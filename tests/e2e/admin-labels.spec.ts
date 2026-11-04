import { acceptFixtureDocuments } from "../helpers/legal-evidence";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { test, expect, selectTheme } from "./fixtures";

loadEnvConfig(process.cwd(), true);
for (const locale of ["en", "es"]) {
  test(`admin related labels render without detail request fanout (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const token = randomBytes(32).toString("base64url");
    let user = "";
    try {
      user = (
        await pool.query(
          "INSERT INTO users(first_name,last_name,display_name,email,password_hash,date_of_birth,admin) VALUES ('Label','Owner','Friendly owner',$1,'synthetic','1990-01-01',true) RETURNING id",
          [`labels-${randomUUID()}@example.test`],
        )
      ).rows[0].id;
      await acceptFixtureDocuments(pool, user);
      await pool.query(
        "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [user, createHash("sha256").update(token).digest("hex")],
      );
      await pool.query(
        "INSERT INTO track_lists(owner_id,name,normalized_name) SELECT $1,'Label list '||i,'label list '||i FROM generate_series(1,100) i",
        [user],
      );
      await context.addCookies([
        { name: "track_atlas_session", value: token, url: baseURL! },
      ]);
      const reads: string[] = [];
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith("/api/admin/")) reads.push(path);
      });
      const listUrl = `/${locale}/admin/track_lists?owner_id=${user}&pageSize=100&sort=name&direction=asc`;
      for (const theme of ["light", "dark"] as const) {
        await page.goto(listUrl);
        await selectTheme(page, theme);
        await expect(
          page
            .getByRole("table")
            .getByRole("link", { name: "Friendly owner", exact: true }),
        ).toHaveCount(100);
        await page.waitForLoadState("networkidle");
        expect(
          reads.filter((path) => path.startsWith("/api/admin/users/")),
        ).toEqual([]);
        const ownerLink = page
          .getByRole("table")
          .getByRole("link", { name: "Friendly owner", exact: true })
          .first();
        await expect(ownerLink).toHaveAttribute(
          "href",
          `/${locale}/admin/users/${encodeURIComponent(JSON.stringify([user]))}`,
        );
        await page
          .getByRole("table")
          .getByRole("link", {
            name: locale === "en" ? "Details" : "Detalles",
            exact: true,
          })
          .first()
          .click();
        await expect(
          page
            .getByRole("definition")
            .getByRole("link", { name: "Friendly owner", exact: true }),
        ).toBeVisible();
        await page.waitForLoadState("networkidle");
        expect(
          reads.filter((path) => path.startsWith("/api/admin/users/")),
        ).toEqual([]);
        await page
          .getByRole("link", {
            name: locale === "en" ? "Back to results" : "Volver a resultados",
          })
          .click();
        await expect(page).toHaveURL(`${baseURL}${listUrl}`);
        await expect(
          page
            .getByRole("table")
            .getByRole("link", { name: "Friendly owner", exact: true }),
        ).toHaveCount(100);
        for (const [model, field, label] of [
          [
            "tracks",
            "segment_count",
            locale === "en" ? "Segment count" : "Número de segmentos",
          ],
          [
            "track_data",
            "segment_starts",
            locale === "en"
              ? "Segment sample offsets"
              : "Índices de inicio de segmento",
          ],
          [
            "track_directional_representations",
            "segment_index",
            locale === "en"
              ? "Segment index (zero-based)"
              : "Índice de segmento (desde cero)",
          ],
        ]) {
          await page.goto(`/${locale}/admin/${model}`);
          await expect(
            page.locator(`select[name="sort"] option[value="${field}"]`),
          ).toHaveText(label);
        }
      }
    } finally {
      if (user) await pool.query("DELETE FROM users WHERE id=$1", [user]);
      await pool.end();
    }
  });
}

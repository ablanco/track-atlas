import { test, expect } from "@playwright/test";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import pt from "../../messages/pt.json";
import de from "../../messages/de.json";
import it from "../../messages/it.json";
loadEnvConfig(process.cwd(), true);
const url = new URL(process.env.DATABASE_URL!);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  (url.pathname !== "/track_atlas_digest_75" &&
    !url.pathname.startsWith("/track_atlas_follow_"))
)
  throw Error("Task-owned development database required");
const pool = new Pool({ connectionString: url.href });
test.use({ trace: "off" }); // Bearer-token pages must not enter trace artifacts.
test.afterAll(() => pool.end());
for (const [locale, catalog] of Object.entries({ en, es, fr, pt, de, it }))
  for (const colorScheme of ["light", "dark"] as const)
    test(`${locale} ${colorScheme} scanner GET, keyboard confirmation and replay`, async ({
      page,
    }) => {
      const token = randomBytes(32).toString("base64url");
      const {
        rows: [user],
      } = await pool.query(
        `INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES('Digest','Tester',$1,'synthetic','1990-01-01') RETURNING id`,
        [`digest-browser-${randomUUID()}@example.test`],
      );
      try {
        await pool.query(
          `INSERT INTO digest_opt_out_tokens(recipient_id,token_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '90 days')`,
          [user.id, createHash("sha256").update(token).digest("hex")],
        );
        await page.emulateMedia({ colorScheme });
        const requests: string[] = [];
        page.on("request", (r) => requests.push(new URL(r.url()).pathname));
        const response = await page.goto(
          `/${locale}/digest-opt-out?token=${token}`,
        );
        expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
        expect(response?.headers()["cache-control"]).toContain("no-store");
        await expect(
          page.getByRole("heading", { name: catalog.DigestOptOut.title }),
        ).toBeVisible();
        expect(
          (
            await pool.query(
              "SELECT digest_emails_enabled FROM users WHERE id=$1",
              [user.id],
            )
          ).rows[0].digest_emails_enabled,
        ).toBe(true);
        expect(
          await page.evaluate(
            () =>
              document.querySelectorAll("script,img,link[rel=stylesheet]")
                .length,
          ),
        ).toBe(0);
        expect(
          await page.evaluate(
            () => getComputedStyle(document.body).backgroundColor,
          ),
        ).toBe(
          colorScheme === "light" ? "rgb(255, 255, 255)" : "rgb(23, 23, 23)",
        );
        await page.keyboard.press("Tab");
        await expect(
          page.getByRole("button", { name: catalog.DigestOptOut.confirm }),
        ).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("status")).toHaveText(
          catalog.DigestOptOut.done,
        );
        expect(page.url()).not.toContain("token=");
        const state = (
          await pool.query(
            "SELECT digest_emails_enabled,discussion_emails_enabled FROM users WHERE id=$1",
            [user.id],
          )
        ).rows[0];
        expect(state).toEqual({
          digest_emails_enabled: false,
          discussion_emails_enabled: true,
        });
        await page.goto(`/${locale}/digest-opt-out?token=${token}`);
        await page
          .getByRole("button", { name: catalog.DigestOptOut.confirm })
          .click();
        await expect(page.getByRole("status")).toHaveText(
          catalog.DigestOptOut.invalid,
        );
        expect(
          requests.every(
            (path) =>
              path === `/${locale}/digest-opt-out` || path === "/favicon.ico",
          ),
        ).toBe(true);
      } finally {
        await pool.query("DELETE FROM users WHERE id=$1", [user.id]);
      }
    });

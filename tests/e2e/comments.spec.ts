import { cleanupTrackOwners } from "../helpers/track-fixture-cleanup";
import { acceptFixtureDocuments } from "../helpers/legal-evidence";
import { solveCaptcha } from "./captcha-helpers";
import enMessages from "../../messages/en.json";
import esMessages from "../../messages/es.json";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import type { BrowserContext } from "@playwright/test";
import { test, expect, selectTheme } from "./fixtures";
import { stubBasemap } from "../helpers/map";

loadEnvConfig(process.cwd(), true);
if (
  !process.env.DATABASE_URL ||
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(process.env.DATABASE_URL).hostname,
  )
)
  throw Error("Loopback development database required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const accounts = new Set<string>();
const proofs = new Set<string>();
test.describe.configure({ mode: "default" });
test.use({ timezoneId: "America/New_York" });
test.afterEach(async () => {
  await cleanupTrackOwners(pool, accounts);
  accounts.clear();
  for (const proof of proofs)
    await pool.query("DELETE FROM captcha_uses WHERE challenge_hash=$1", [
      proof,
    ]);
  proofs.clear();
});
test.afterAll(() => pool.end());
test.beforeEach(async ({ page }) => {
  await stubBasemap(page);
});
async function account(
  context: BrowserContext,
  baseURL: string,
  confirmed = true,
) {
  const token = randomBytes(32).toString("base64url");
  const {
    rows: [user],
  } = await pool.query(
    "INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth,email_confirmed) VALUES('Ada','Lovelace',$1,'synthetic','1815-12-10',$2) RETURNING id",
    [`comments-${randomUUID()}@example.test`, confirmed],
  );
  accounts.add(user.id);
  await acceptFixtureDocuments(pool, user.id);
  await pool.query(
    "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
    [user.id, createHash("sha256").update(token).digest("hex")],
  );
  await context.addCookies([
    {
      name: "track_atlas_session",
      value: token,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return user.id as string;
}
async function track(context: BrowserContext, baseURL: string) {
  const response = await context.request.post("/api/tracks", {
    headers: { origin: baseURL },
    multipart: {
      name: "Discussion ridge",
      description: "Discussion fixture",
      activity: "hiking",
      difficulty: "3",
      tags: "[]",
      requestId: randomUUID(),
      file: {
        name: "ridge.gpx",
        mimeType: "application/gpx+xml",
        buffer: Buffer.from(
          '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test"><trk><trkseg><trkpt lat="40" lon="-3"/><trkpt lat="40.001" lon="-3.001"/></trkseg></trk></gpx>',
        ),
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const id = (await response.json()).id as string;
  await pool.query("UPDATE tracks SET visibility='public' WHERE id=$1", [id]);
  return id;
}

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    const labels = (locale === "en" ? enMessages : esMessages).Comments;
    const prefs = (locale === "en" ? enMessages : esMessages).Settings
      .discussion;
    test(`${locale} ${theme} comments show plain text, reader timezone and guest login`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.grantPermissions([]);
      const owner = await account(context, baseURL!);
      const id = await track(context, baseURL!);
      await pool.query(
        "INSERT INTO track_comments(track_id,author_id,text,created_at) VALUES($1,$2,$3,'2026-01-02T12:00:00Z')",
        [id, owner, "<b>Plain</b>\nhttps://example.test **text**"],
      );
      await context.clearCookies();
      await page.goto(`/${locale}/tracks/${id}`);
      await selectTheme(page, theme);
      const section = page.getByRole("region", {
        name: labels.title,
        exact: true,
      });
      await expect(section).toContainText(
        "<b>Plain</b>\nhttps://example.test **text**",
      );
      await expect(
        section.locator("b, a[href='https://example.test']"),
      ).toHaveCount(0);
      await expect(section).toContainText("Ada L.");
      await expect(section.locator("time")).toContainText(
        locale === "en"
          ? "Jan 2, 2026, 07:00 AM EST"
          : "2 ene 2026, 07:00 GMT-5",
      );
      await section
        .getByRole("button", { name: labels.leave, exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(section.getByRole("textbox")).toHaveCount(0);
    });

    test(`${locale} ${theme} comments resolve direct links across pages and preserve the owner reply`, async ({
      page,
      context,
      baseURL,
    }) => {
      const owner = await account(context, baseURL!);
      const id = await track(context, baseURL!);
      const parents: string[] = [];
      for (let n = 1; n <= 11; n++) {
        const {
          rows: [comment],
        } = await pool.query(
          "INSERT INTO track_comments(track_id,author_id,text,created_at) VALUES($1,$2,$3,'2026-01-02T12:00:00Z'::timestamptz + $4 * interval '1 minute') RETURNING id",
          [id, owner, `Comment ${n}`, n],
        );
        parents.push(comment.id);
      }
      await pool.query(
        "INSERT INTO track_comment_replies(comment_id,author_id,text) VALUES($1,$2,'Owner answer')",
        [parents[10], owner],
      );
      await page.goto(`/${locale}/tracks/${id}?comment=${parents[10]}`);
      await selectTheme(page, theme);
      const section = page.getByRole("region", {
        name: labels.title,
        exact: true,
      });
      await expect(section).toContainText("Comment 11");
      await expect(section).toContainText("Owner answer");
      await expect(section.getByText("Comment 1", { exact: true })).toHaveCount(
        0,
      );
      await expect(
        section.getByRole("link", {
          name: locale === "en" ? "Page 2" : "Página 2",
          exact: true,
        }),
      ).toHaveAttribute("aria-current", "page");
      await expect(section.locator(`#comment-${parents[10]}`)).toBeFocused();
      await section
        .getByRole("link", { name: labels.previous, exact: true })
        .click();
      await expect(
        section.getByText("Comment 1", { exact: true }),
      ).toBeVisible();
      await expect(
        section.getByText("Comment 11", { exact: true }),
      ).toHaveCount(0);
      await page.goto(`/${locale}/tracks/${id}?comment=${randomUUID()}`);
      await selectTheme(page, theme);
      await expect(section.getByRole("alert")).toContainText(
        labels.errors.notFound,
      );
    });

    test(`${locale} ${theme} confirmed owner posts on page two, replies once and gets safe validation and throttle errors`, async ({
      page,
      context,
      baseURL,
    }) => {
      const owner = await account(context, baseURL!);
      const id = await track(context, baseURL!);
      for (let n = 0; n < 10; n++)
        await pool.query(
          "INSERT INTO track_comments(track_id,author_id,text,created_at) VALUES($1,$2,$3,'2026-01-01T00:00:00Z'::timestamptz + $4 * interval '1 minute')",
          [id, owner, `Earlier ${n}`, n],
        );
      await page.goto(`/${locale}/tracks/${id}`);
      await selectTheme(page, theme);
      const section = page.getByRole("region", {
        name: labels.title,
        exact: true,
      });
      await section
        .getByRole("button", { name: labels.leave, exact: true })
        .click();
      const input = section.getByRole("textbox", {
        name: labels.text,
        exact: true,
      });
      await input.fill(" ");
      await section
        .getByRole("button", { name: labels.submit, exact: true })
        .click();
      await expect(section.getByRole("alert")).toContainText("2000");
      await input.fill(" 💚".repeat(1000) + " ");
      await section
        .getByRole("button", { name: labels.submit, exact: true })
        .click();
      await expect(input).toHaveCount(0);
      await expect(
        section.getByRole("link", {
          name: locale === "en" ? "Page 2" : "Página 2",
          exact: true,
        }),
      ).toHaveAttribute("aria-current", "page");
      await expect(page).toHaveURL(/\?comment=[a-f0-9-]+/);
      await section
        .getByRole("button", { name: labels.reply, exact: true })
        .click();
      const reply = section.getByRole("textbox", {
        name: labels.replyText,
        exact: true,
      });
      await reply.fill("Owner response\nsecond line");
      await section
        .getByRole("button", { name: labels.submit, exact: true })
        .click();
      await expect(section.getByRole("alert")).toContainText("30");
      await expect(reply).toHaveValue("Owner response\nsecond line");
      await pool.query(
        "UPDATE discussion_post_events SET created_at=clock_timestamp()-interval '31 seconds' WHERE author_id=$1",
        [owner],
      );
      await section
        .getByRole("button", { name: labels.submit, exact: true })
        .click();
      await expect(reply).toHaveCount(0);
      await expect(section).toContainText("Owner response\nsecond line");
      await expect(
        section.getByRole("button", { name: labels.reply, exact: true }),
      ).toHaveCount(0);
      await section
        .getByRole("button", { name: labels.leave, exact: true })
        .click();
      await input.fill("Cancelled draft");
      await section
        .getByRole("button", { name: labels.cancel, exact: true })
        .click();
      await expect(input).toHaveCount(0);
    });

    test(`${locale} ${theme} comments discard hidden drafts, refresh confirmation and revoked access on restore`, async ({
      page,
      context,
      baseURL,
    }) => {
      const owner = await account(context, baseURL!);
      const id = await track(context, baseURL!);
      await context.clearCookies();
      const viewer = await account(context, baseURL!, false);
      await page.goto(`/${locale}/tracks/${id}`);
      await selectTheme(page, theme);
      const section = page.getByRole("region", {
        name: labels.title,
        exact: true,
      });
      const leave = section.getByRole("button", {
        name: labels.leave,
        exact: true,
      });
      await leave.click();
      await expect(section.getByRole("status")).toContainText(labels.confirm);
      await expect(
        section.getByRole("link", { name: labels.settings, exact: true }),
      ).toHaveAttribute("href", `/${locale}/settings`);
      await expect(section.getByRole("textbox")).toHaveCount(0);
      await pool.query("UPDATE users SET email_confirmed=true WHERE id=$1", [
        viewer,
      ]);
      await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent("pagehide"));
      });
      await expect(leave).toHaveCount(0);
      await page.evaluate(() => {
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true }),
        );
      });
      await leave.click();
      const input = section.getByRole("textbox", {
        name: labels.text,
        exact: true,
      });
      await input.fill("Private unsaved draft");
      await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent("pagehide"));
      });
      await expect(input).toHaveCount(0);
      await page.evaluate(() => {
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true }),
        );
      });
      await leave.click();
      await expect(input).toHaveValue("");
      await expect(
        section.getByRole("button", { name: labels.reply, exact: true }),
      ).toHaveCount(0);
      await pool.query("DELETE FROM sessions WHERE user_id=$1", [viewer]);
      await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await leave.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await pool.query("UPDATE tracks SET visibility='private' WHERE id=$1", [
        id,
      ]);
      await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await expect(section.getByRole("alert")).toContainText(
        labels.errors.notFound,
      );
      await expect(leave).toHaveCount(0);
      expect(owner).not.toBe(viewer);
    });

    test(`${locale} ${theme} discussion preferences initialize from site locale, persist toggle/language and refresh after restore`, async ({
      page,
      context,
      baseURL,
    }) => {
      await account(context, baseURL!, false);
      await page.goto(`/${locale}/settings`);
      await selectTheme(page, theme);
      const form = page.getByRole("form", {
        name: prefs.title,
        exact: true,
      });
      await expect(form).toBeVisible();
      const toggle = form.getByRole("switch", {
        name: prefs.enabled,
        exact: true,
      });
      await expect(toggle).toBeChecked();
      const language = form.getByRole("combobox", {
        name: prefs.locale,
        exact: true,
      });
      await expect(language).toContainText(
        locale === "es" ? "Español" : "English",
      );
      await form
        .getByRole("button", { name: prefs.submit, exact: true })
        .click();
      await expect(form.getByRole("status")).toContainText(prefs.saved);
      let saved = await context.request.get("/api/discussion-preferences");
      expect(await saved.json()).toEqual({ enabled: true, locale });
      await toggle.click();
      await language.click();
      await page.getByRole("option", { name: "English", exact: true }).click();
      await form
        .getByRole("button", { name: prefs.submit, exact: true })
        .click();
      await expect(form.getByRole("status")).toContainText(prefs.saved);
      saved = await context.request.get("/api/discussion-preferences");
      expect(await saved.json()).toEqual({ enabled: false, locale: "en" });
      await page.reload();
      await expect(toggle).not.toBeChecked();
      await expect(language).toContainText("English");
      await toggle.click();
      await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent("pagehide"));
      });
      await expect(toggle).toHaveCount(0);
      await page.evaluate(() => {
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true }),
        );
      });
      await expect(toggle).not.toBeChecked();
    });
  }
}

test("comment identity and protected avatar stay current and direct links survive a language switch", async ({
  page,
  context,
  baseURL,
}) => {
  await account(context, baseURL!);
  const id = await track(context, baseURL!);
  await context.clearCookies();
  const author = await account(context, baseURL!);
  const sharp = (await import("sharp")).default;
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#32776a" },
  })
    .png()
    .toBuffer();
  const upload = await context.request.post("/api/files?purpose=avatar", {
    data: bytes,
    headers: { origin: baseURL!, "content-type": "image/png" },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const parents: string[] = [];
  for (let n = 1; n <= 11; n++) {
    const {
      rows: [parent],
    } = await pool.query(
      "INSERT INTO track_comments(track_id,author_id,text,created_at) VALUES($1,$2,$3,'2026-01-01T00:00:00Z'::timestamptz + $4 * interval '1 minute') RETURNING id",
      [id, author, `Identity comment ${n}`, n],
    );
    parents.push(parent.id);
  }
  await context.clearCookies();
  await page.goto(`/en/tracks/${id}?comment=${parents[10]}`);
  const section = page.getByRole("region", { name: "Comments", exact: true });
  await expect(section).toContainText("Identity comment 11");
  const avatar = section.locator("img");
  await expect(avatar).toHaveAttribute(
    "src",
    `/api/tracks/${id}/comments/${parents[10]}/avatar`,
  );
  expect(
    await avatar.evaluate(
      (image) => image instanceof HTMLImageElement && image.naturalWidth,
    ),
  ).toBe(24);
  await pool.query("UPDATE users SET display_name='Trail person' WHERE id=$1", [
    author,
  ]);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await expect(section).toContainText("Trail person");
  await pool.query("UPDATE users SET active=false WHERE id=$1", [author]);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await expect(section).toContainText("Deactivated user");
  await expect(avatar).toHaveCount(0);
  await page.getByRole("contentinfo").getByRole("combobox").click();
  await page.getByRole("option", { name: "Español", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/es/tracks/${id}\\?comment=${parents[10]}`),
  );
  const translated = page.getByRole("region", {
    name: "Comentarios",
    exact: true,
  });
  await expect(translated).toContainText("Identity comment 11");
  await expect(translated).toContainText("Usuario desactivado");
});

test("discussion discards drafts across cached page navigation and reauthorizes on Back", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await account(context, baseURL!);
  const id = await track(context, baseURL!);
  await page.goto(`/en/tracks/${id}`);
  const section = page.getByRole("region", { name: "Comments", exact: true });
  await section
    .getByRole("button", { name: "Leave comment", exact: true })
    .click();
  await section
    .getByRole("textbox", { name: "Comment", exact: true })
    .fill("Draft before navigation");
  await page.getByRole("banner").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/en$/);
  await pool.query("DELETE FROM sessions WHERE user_id=$1", [owner]);
  await page.goBack();
  await expect(section.getByRole("textbox")).toHaveCount(0);
  await section
    .getByRole("button", { name: "Leave comment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

for (const locale of ["en", "es"] as const) {
  test(`${locale} comment login verifies the real widget and refreshes posting eligibility`, async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await account(context, baseURL!);
    const id = await track(context, baseURL!);
    const salt = Buffer.alloc(16, 21);
    const hash = `$scrypt$v=1$N=32768,r=8,p=3$${salt.toString("base64url")}$${scryptSync("browser password", salt, 64, { N: 32768, r: 8, p: 3, maxmem: 67108864 }).toString("base64url")}`;
    const {
      rows: [user],
    } = await pool.query(
      "UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING email",
      [hash, owner],
    );
    await context.clearCookies();
    await page.goto(`/${locale}/tracks/${id}`);
    const labels = (locale === "en" ? enMessages : esMessages).Comments;
    const section = page.getByRole("region", {
      name: labels.title,
      exact: true,
    });
    await section
      .getByRole("button", { name: labels.leave, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('[name="email"]').fill(user.email);
    await dialog.locator('[name="password"]').fill("browser password");
    proofs.add(await solveCaptcha(page, dialog));
    await dialog
      .getByRole("button", {
        name: locale === "en" ? "Log in" : "Iniciar sesión",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    await section
      .getByRole("button", { name: labels.leave, exact: true })
      .click();
    await expect(
      section.getByRole("textbox", { name: labels.text, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${locale}/tracks/${id}$`));
  });
}

test("posting after session revocation explains the failure and removes the stale form", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await account(context, baseURL!);
  const id = await track(context, baseURL!);
  await page.goto(`/en/tracks/${id}`);
  const section = page.getByRole("region", { name: "Comments", exact: true });
  await section
    .getByRole("button", { name: "Leave comment", exact: true })
    .click();
  await section
    .getByRole("textbox", { name: "Comment", exact: true })
    .fill("Revoked draft");
  await pool.query("DELETE FROM sessions WHERE user_id=$1", [owner]);
  await section.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(section.getByRole("alert")).toContainText("session has ended");
  await expect(section.getByRole("textbox")).toHaveCount(0);
  await section
    .getByRole("button", { name: "Leave comment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

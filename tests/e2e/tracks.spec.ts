import { acceptFixtureDocuments } from "../helpers/legal-evidence";
import { selectLanguage, expect, test, selectTheme } from "./fixtures";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import type { BrowserContext, Page } from "@playwright/test";
import {
  stubBasemap,
  mapCoordinates,
  mapSegments,
  observeMap,
} from "../helpers/map";
import { activityTypes } from "../../tracks/validation";
import enMessages from "../../messages/en.json";
import esMessages from "../../messages/es.json";

loadEnvConfig(process.cwd(), true);
// Keep real uploads and upper-limit rendering sequential within this file;
// the application intentionally rejects excess concurrent processing workers.
test.describe.configure({ mode: "default" });
let pool: Pool;
test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});
const owners = new Set<string>();
const gpx = Buffer.from(
  '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test"><trk><trkseg><trkpt lat="40" lon="-3"/><trkpt lat="40.001" lon="-3.001"/></trkseg></trk></gpx>',
);
test.afterAll(() => pool.end());
test.beforeEach(async ({ page }, testInfo) => {
  if (!testInfo.title.includes("live hosted basemap")) await stubBasemap(page);
  else await observeMap(page);
});
test.afterEach(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const id of owners) {
      await client.query(
        "UPDATE track_photos SET track_id=NULL WHERE track_id IN (SELECT id FROM tracks WHERE owner_id=$1)",
        [id],
      );
      await client.query(
        "DELETE FROM track_photos WHERE id IN (SELECT id FROM stored_files WHERE owner_id=$1)",
        [id],
      );
      await client.query(
        "DELETE FROM track_upload_attempts WHERE owner_id=$1",
        [id],
      );
      await client.query("DELETE FROM tracks WHERE owner_id=$1", [id]);
      await client.query("DELETE FROM stored_files WHERE owner_id=$1", [id]);
      await client.query("DELETE FROM users WHERE id=$1", [id]);
    }
    await client.query("COMMIT");
    owners.clear();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
    [`tracks-${randomUUID()}@example.test`, confirmed],
  );
  owners.add(user.id);
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
async function expectCreatedToast(page: Page, en: boolean, count: number) {
  const notification = page.locator('[data-slot="toast"]');
  await expect(notification).toContainText(
    en ? `${count} Tracks created` : `${count} tracks creados`,
  );
  await expect(notification.getByRole("link")).toHaveCount(0);
  await expect(
    page.getByRole("region", {
      name: en ? "Upload complete" : "Subida completada",
    }),
  ).toHaveCount(0);
}

async function outputIds(ownerId: string): Promise<string[]> {
  const { rows } = await pool.query(
    "SELECT id FROM tracks WHERE owner_id=$1 ORDER BY upload_index",
    [ownerId],
  );
  return rows.map((row) => row.id);
}

async function fillTrack(
  page: import("@playwright/test").Page,
  en: boolean,
  fileBytes = gpx,
) {
  await page
    .getByLabel(en ? "Name" : "Nombre", { exact: true })
    .fill("Private ridge");
  // Cache Components retains hidden detail regions also labeled Description.
  await page
    .locator("form:visible")
    .getByLabel(en ? "Description" : "Descripción", { exact: true })
    .fill("First line\n<script>plain text</script>");
  await page
    .getByLabel(en ? "GPX file" : "Archivo GPX", { exact: true })
    .setInputFiles({
      name: "ridge.gpx",
      mimeType: "application/gpx+xml",
      buffer: fileBytes,
    });
  const activities = page.getByRole("radiogroup", {
    name: en ? "Activity type" : "Tipo de actividad",
  });
  await expect(activities.getByRole("radio")).toHaveCount(16);
  await activities
    .getByRole("radio", { name: en ? "Hiking" : "Senderismo", exact: true })
    .check();
  await page.getByRole("radio", { name: "3", exact: true }).check();
  const tags = page.getByRole("textbox", { name: en ? /Tags/ : /Etiquetas/ });
  await tags.fill("High ridge");
  await tags.press("Enter");
}
for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    const en = locale === "en";
    test(`${locale} ${theme} activity tiles are responsive, labeled and keyboard accessible`, async ({
      context,
      page,
      baseURL,
    }) => {
      await account(context, baseURL!);
      await page.goto(`/${locale}/tracks/upload`);
      await selectTheme(page, theme);
      const activities = page.getByRole("radiogroup", {
        name: en ? "Activity type" : "Tipo de actividad",
      });
      const labels = (en ? enMessages : esMessages).Tracks.activities;
      await expect(activities).toHaveAttribute("aria-required", "true");
      await expect(
        activities.getByRole("radio", { checked: true }),
      ).toHaveCount(0);
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        const columns = await activities.evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(" ").length,
        );
        expect(columns).toBe(width === 390 ? 2 : 4);
        for (const activity of activityTypes) {
          const tile = activities.getByRole("radio", {
            name: labels[activity],
            exact: true,
          });
          await expect(tile).toBeVisible();
          const geometry = await tile.evaluate((element) => {
            const tile = element.getBoundingClientRect();
            const icon = element.querySelector("svg")!.getBoundingClientRect();
            const label = element
              .querySelector("span:not([aria-hidden])")!
              .getBoundingClientRect();
            return {
              width: tile.width,
              height: tile.height,
              iconBottom: icon.bottom,
              labelTop: label.top,
              contained: element.scrollWidth <= element.clientWidth,
            };
          });
          expect(geometry.width).toBeGreaterThanOrEqual(44);
          expect(geometry.height).toBeGreaterThanOrEqual(44);
          expect(geometry.iconBottom).toBeLessThanOrEqual(geometry.labelTop);
          expect(geometry.contained).toBe(true);
          await tile.check();
          await expect(tile).toBeChecked();
          await expect(
            activities.getByRole("radio", { checked: true }),
          ).toHaveCount(1);
          await expect(
            activities.locator('input[name="activity"]:checked'),
          ).toHaveValue(activity);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      const walking = activities.getByRole("radio", {
        name: labels.walking,
        exact: true,
      });
      await walking.focus();
      await walking.press("Space");
      await expect(walking).toBeChecked();
      await walking.press("ArrowRight");
      const hiking = activities.getByRole("radio", {
        name: labels.hiking,
        exact: true,
      });
      await expect(hiking).toBeChecked();
      await expect(hiking).toBeFocused();
      expect(
        await hiking.evaluate((element) => getComputedStyle(element).boxShadow),
      ).not.toBe("none");
      await hiking.press("Tab");
      await expect(
        page.getByRole("radio", { name: "1", exact: true }),
      ).toBeFocused();
      await fillTrack(page, en);
      let releaseRequest = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseRequest = resolve;
      });
      await page.route("**/api/tracks", async (route) => {
        await gate;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "unavailable" }),
        });
      });
      try {
        await page
          .getByRole("button", {
            name: en ? "Upload track" : "Subir recorrido",
            exact: true,
          })
          .click();
        for (const activity of activityTypes)
          await expect(
            activities.getByRole("radio", {
              name: labels[activity],
              exact: true,
            }),
          ).toBeDisabled();
      } finally {
        releaseRequest();
      }
      // An unavailable acknowledgement must be resolved before editing a possible success.
      await expect(hiking).toBeDisabled();
      await expect(hiking).toBeChecked();
    });
    test(`${locale} ${theme} successful upload resets the form for menu and history navigation`, async ({
      context,
      page,
      baseURL,
    }) => {
      await account(context, baseURL!);
      await page.goto(`/${locale}/tracks/upload`);
      await selectTheme(page, theme);
      const form = page.getByRole("form", {
        name: en ? "Upload track" : "Subir recorrido",
      });
      const submit = form.getByRole("button", {
        name: en ? "Upload track" : "Subir recorrido",
        exact: true,
      });
      await expect(submit).toBeDisabled();
      await fillTrack(page, en);
      await page
        .getByRole("radio", { name: en ? "Public" : "Público", exact: true })
        .check();
      const tags = page.getByRole("textbox", {
        name: en ? "Tags" : "Etiquetas",
        exact: true,
      });
      await tags.fill("High ridge");
      await tags.press("Enter");
      await expect(page.locator("#track-tags-error")).toBeVisible();
      await submit.click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/tracks/[0-9a-f-]{36}$`),
      );
      const firstUrl = page.url();
      async function expectFreshForm() {
        await expect(form).toBeVisible();
        await expect(
          form.getByRole("textbox", {
            name: en ? "Name" : "Nombre",
            exact: true,
          }),
        ).toHaveValue("");
        await expect(
          form.getByRole("textbox", {
            name: en ? "Description" : "Descripción",
            exact: true,
          }),
        ).toHaveValue("");
        await expect(
          form.getByLabel(en ? "GPX file" : "Archivo GPX", { exact: true }),
        ).toHaveValue("");
        await expect(
          form
            .getByRole("radiogroup", {
              name: en ? "Activity type" : "Tipo de actividad",
            })
            .getByRole("radio", { checked: true }),
        ).toHaveCount(0);
        for (const value of [1, 2, 3, 4, 5])
          await expect(
            form.getByRole("radio", { name: String(value), exact: true }),
          ).not.toBeChecked();
        await expect(tags).toHaveValue("");
        await expect(
          form.getByRole("button", { name: /High ridge/ }),
        ).toHaveCount(0);
        await expect(page.locator("#track-tags-error")).toBeHidden();
        await expect(form.getByRole("alert")).toHaveCount(0);
        await expect(form.locator('[aria-invalid="true"]')).toHaveCount(0);
        await expect(
          form.getByRole("radio", {
            name: en ? "Private" : "Privado",
            exact: true,
          }),
        ).toBeChecked();
        await expect(submit).toBeDisabled();
      }
      await page.getByRole("button", { name: "Ada L.", exact: true }).click();
      await page
        .getByRole("menuitem", {
          name: en ? "Upload track" : "Subir recorrido",
        })
        .click();
      await expectFreshForm();
      await page.goBack();
      await expect(page).toHaveURL(firstUrl);
      await page.goBack();
      await expectFreshForm();
      await fillTrack(page, en);
      await submit.click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/tracks/[0-9a-f-]{36}$`),
      );
      expect(page.url()).not.toBe(firstUrl);
    });
    test(`${locale} ${theme} uploads without optional tags`, async ({
      context,
      page,
      baseURL,
    }) => {
      await account(context, baseURL!);
      await page.goto(`/${locale}/tracks/upload`);
      await selectTheme(page, theme);
      await fillTrack(page, en);
      await page
        .getByRole("button", {
          name: en ? "Remove High ridge" : "Eliminar High ridge",
          exact: true,
        })
        .click();
      await expect(page.locator("#track-tags-hint")).toContainText(
        en ? "Optional" : "Opcionales",
      );
      await page
        .getByRole("button", {
          name: en ? "Upload track" : "Subir recorrido",
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/tracks/[0-9a-f-]{36}$`),
      );
      await expect(
        page.getByRole("heading", { name: "Private ridge" }),
      ).toBeVisible();
      const id = page.url().split("/").pop()!;
      const { rows } = await pool.query(
        "SELECT count(*)::int AS count FROM track_tags WHERE track_id=$1",
        [id],
      );
      expect(rows[0].count).toBe(0);
      const activityName = en ? "Hiking" : "Senderismo";
      const activityIcon = page
        .locator("article > header")
        .getByRole("button", { name: activityName, exact: true });
      const activityHint = page.getByRole("dialog", {
        name: activityName,
        exact: true,
      });
      await expect(activityIcon.locator("svg")).toBeVisible();
      const iconBox = await activityIcon.boundingBox();
      const titleBox = await page
        .getByRole("heading", { level: 1, name: "Private ridge" })
        .boundingBox();
      expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(titleBox!.x);
      await activityIcon.hover();
      await expect(activityHint).toHaveText(activityName);
      await page.keyboard.press("Escape");
      await expect(activityHint).toBeHidden();
      await page.mouse.move(0, 0);
      await page.setViewportSize({ width: 390, height: 844 });
      await activityIcon.click();
      await expect(activityHint).toHaveText(activityName);
      await page.keyboard.press("Escape");
      await expect(activityHint).toBeHidden();
      await expect(
        page.getByRole("region", {
          name: en ? "Tags" : "Etiquetas",
          exact: true,
        }),
      ).toHaveCount(0);
    });
    test(`${locale} ${theme} track file picker matches settings avatar picker`, async ({
      context,
      page,
      baseURL,
    }) => {
      await account(context, baseURL!);
      await page.goto(`/${locale}/settings`);
      await selectTheme(page, theme);
      const avatar = page.locator('input[type="file"]');
      await expect(avatar).toBeEnabled();
      const pickerStyles = (element: HTMLElement) => {
        const style = getComputedStyle(element);
        const button = getComputedStyle(element, "::file-selector-button");
        return {
          height: style.height,
          padding: style.padding,
          border: style.border,
          borderRadius: style.borderRadius,
          backgroundColor: style.backgroundColor,
          buttonMarginRight: button.marginRight,
          buttonBorderRight: button.borderRight,
          buttonBorderRightWidth: button.borderRightWidth,
          buttonPaddingRight: button.paddingRight,
          buttonHeight: parseFloat(button.height),
          contentHeight:
            element.clientHeight -
            parseFloat(style.paddingTop) -
            parseFloat(style.paddingBottom),
        };
      };
      const expected = await avatar.evaluate(pickerStyles);
      expect(expected.buttonBorderRightWidth).toBe("1px");
      expect(expected.buttonPaddingRight).toBe("12px");
      // A fixed-height native button leaves extra space below both text labels.
      expect(expected.buttonHeight).toBe(expected.contentHeight);
      await page.goto(`/${locale}/tracks/upload`);
      const file = page.getByLabel(en ? "GPX file" : "Archivo GPX", {
        exact: true,
      });
      await expect(file).toBeEnabled();
      await expect(file).toHaveCSS("border-top-width", "1px");
      expect(await file.evaluate(pickerStyles)).toEqual(expected);
      await file.focus();
      await expect(file).toBeFocused();
      await file.setInputFiles({
        name: "ridge.gpx",
        mimeType: "application/gpx+xml",
        buffer: gpx,
      });
      await expect(file).toHaveJSProperty("value", "C:\\fakepath\\ridge.gpx");
    });
    test(`${locale} ${theme} explicit public upload, current safe identity/avatar and deactivation`, async ({
      context,
      page,
      request,
      baseURL,
    }) => {
      const userId = await account(context, baseURL!);
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}/tracks/upload`);
      await selectTheme(page, theme);
      await fillTrack(page, en);
      await expect(
        page.getByRole("radio", {
          name: en ? "Private" : "Privado",
          exact: true,
        }),
      ).toBeChecked();
      await page
        .getByRole("radio", { name: en ? "Public" : "Público", exact: true })
        .check();
      await expect(page.locator("#track-visibility-hint")).toContainText(
        en
          ? "timestamps, author metadata, waypoints and other locations"
          : "marcas de tiempo, metadatos de autor, puntos de interés y ubicaciones fuera del mapa",
      );
      await expect(page.locator("#track-visibility-hint")).toContainText(
        en
          ? "names, timestamps and track-local extensions remain"
          : "se conservan nombres, marcas de tiempo y extensiones del track",
      );
      await page
        .getByRole("button", {
          name: en ? "Upload track" : "Subir recorrido",
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/tracks/[0-9a-f-]{36}$`),
      );
      const url = page.url();
      const id = url.split("/").pop()!;
      const download = page.getByRole("link", {
        name: en ? "Download GPX" : "Descargar GPX",
        exact: true,
      });
      await expect(download).toBeVisible();
      const ownerCookies = await context.cookies();
      await context.clearCookies();
      await page.reload();
      await expect(download).toHaveCount(0);
      const loginToDownload = page.getByRole("button", {
        name: en ? "Log in to download" : "Inicia sesión para descargar",
        exact: true,
      });
      await expect(loginToDownload).toBeEnabled();
      await loginToDownload.click();
      const loginDialog = page.getByRole("dialog");
      await expect(loginDialog).toBeVisible();
      await expect(loginDialog.locator('input[name="email"]')).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(loginDialog).toHaveCount(0);
      await expect(loginToDownload).toBeFocused();
      await expect(page).toHaveURL(url);
      await context.addCookies(ownerCookies);
      await page.reload();
      await expect(download).toBeVisible();
      await expect(loginToDownload).toHaveCount(0);
      await context.clearCookies();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Private ridge" }),
      ).toBeVisible();
      const identity = page.getByRole("region", {
        name: en ? "Uploaded by" : "Subido por",
      });
      await expect(identity).toContainText("Ada L.");
      await expect(identity.locator('[data-slot="avatar"]')).toHaveCSS(
        "width",
        "128px",
      );
      await expect(identity.locator('[data-slot="avatar"]')).toHaveCSS(
        "height",
        "128px",
      );
      await expect(identity.locator("p")).toHaveCSS("font-size", "24px");
      await expect(identity).not.toContainText("Lovelace");
      await expect(
        identity.locator('[data-slot="avatar-fallback"]'),
      ).toHaveText("AL");
      expect((await request.get(`/api/tracks/${id}/data`)).status()).toBe(200);
      const deniedDownload = await request.get(`/api/tracks/${id}/download`);
      expect(deniedDownload.status()).toBe(401);
      expect(await deniedDownload.json()).toEqual({ error: "unauthorized" });
      await context.addCookies(ownerCookies);
      expect(
        await (await context.request.get(`/api/tracks/${id}/download`)).body(),
      ).toEqual(gpx);
      await context.clearCookies();
      expect((await request.get(`/api/tracks/${id}/avatar`)).status()).toBe(
        404,
      );
      // Current identity is read again; no shared public cache may retain it.
      await pool.query(
        "UPDATE users SET display_name='Ridge walker' WHERE id=$1",
        [userId],
      );
      await page.reload();
      await expect(identity).toContainText("Ridge walker");
      await expect(identity).not.toContainText("Ada L.");
      await context.addCookies(ownerCookies);
      const avatarOriginal = await sharp({
        create: { width: 32, height: 32, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      const uploadAvatar = async () => {
        const response = await context.request.post(
          "/api/files?purpose=avatar",
          {
            headers: { Origin: baseURL!, "Content-Type": "image/png" },
            data: avatarOriginal,
          },
        );
        expect(response.status(), await response.text()).toBe(201);
        return (await response.json()).id as string;
      };
      const firstAvatar = await uploadAvatar();
      await context.clearCookies();
      await page.reload();
      await expect(identity.locator("img")).toBeVisible();
      await expect(identity.locator("img")).toHaveCSS("width", "128px");
      await expect(identity.locator("img")).toHaveCSS("height", "128px");
      expect(
        await identity
          .locator("img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      ).toBe(128);
      expect((await request.get(`/api/files/${firstAvatar}`)).status()).toBe(
        401,
      );
      expect(
        (await request.get(`/api/avatars/${firstAvatar}`)).status(),
      ).not.toBe(200);
      await context.addCookies(ownerCookies);
      const secondAvatar = await uploadAvatar();
      await context.clearCookies();
      expect((await request.get(`/api/tracks/${id}/avatar`)).status()).toBe(
        200,
      );
      await context.addCookies(ownerCookies);
      expect(
        (
          await context.request.delete(`/api/files/${secondAvatar}`, {
            headers: { Origin: baseURL! },
          })
        ).ok(),
      ).toBe(true);
      await context.clearCookies();
      await page.reload();
      await expect(
        identity.locator('[data-slot="avatar-fallback"]'),
      ).toHaveText("RW");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await pool.query("UPDATE users SET active=false WHERE id=$1", [userId]);
      for (const resource of ["data", "download", "avatar"]) {
        const response = await request.get(`/api/tracks/${id}/${resource}`);
        expect(response.status()).toBe(resource === "download" ? 401 : 404);
        expect(await response.json()).toEqual({
          error: resource === "download" ? "unauthorized" : "notFound",
        });
      }
      await page.goto(url);
      await expect(
        page.getByRole("heading", {
          name: en ? "Track not found" : "Recorrido no encontrado",
        }),
      ).toBeVisible();
    });
    test(`${locale} ${theme} accessible analytics charts`, async ({
      context,
      page,
      baseURL,
    }, testInfo) => {
      test.skip(
        !!process.env.TEST_BASE_URL,
        "Requires isolated local storage harness",
      );
      await account(context, baseURL!);
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}`);
      await selectTheme(page, theme);
      await page.getByRole("button", { name: "Ada L.", exact: true }).click();
      await page
        .getByRole("menuitem", {
          name: en ? "Upload track" : "Subir recorrido",
        })
        .click();
      await fillTrack(
        page,
        en,
        Buffer.from(
          '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test"><trk><trkseg><trkpt lat="40" lon="-3"><ele>10</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="40.001" lon="-3.001"><ele>20</ele><time>2026-01-01T00:01:00Z</time></trkpt><trkpt lat="40.002" lon="-3.002"><ele>15</ele><time>2026-01-01T00:02:00Z</time></trkpt><trkpt lat="40.003" lon="-3.003"><ele>30</ele><time>2026-01-01T00:03:00Z</time></trkpt></trkseg></trk></gpx>',
        ),
      );
      await page
        .getByRole("button", {
          name: en ? "Upload track" : "Subir recorrido",
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/tracks/[0-9a-f-]{36}$`),
      );
      await expect(
        page.getByRole("region", {
          name: en ? "Recorded analytics" : "Estadísticas registradas",
        }),
      ).toContainText("20 m");
      const elevationChart = page.getByRole("group", {
        name: new RegExp(
          en
            ? "Elevation by recorded distance"
            : "Altitud según la distancia registrada",
        ),
      });
      const speedChart = page.getByRole("group", {
        name: new RegExp(
          en
            ? "Average speed by recorded distance"
            : "Velocidad media según la distancia registrada",
        ),
      });
      await expect(elevationChart).toBeVisible();
      await expect(speedChart).toBeVisible();
      const labels = (en ? enMessages : esMessages).Tracks;
      const stats = page.getByLabel(labels.mainStats, { exact: true });
      await expect(stats.locator("dt")).toHaveText([
        labels.votes.popularity,
        labels.length,
        labels.difficulty,
        labels.analytics.range,
        labels.analytics.ascent,
        labels.analytics.descent,
      ]);
      await expect(stats.locator("dd").nth(2)).toHaveText("3 / 5");
      // Multiple climbs distinguish elevation range from cumulative ascent.
      await expect(stats.locator("dd").nth(3)).toHaveText("20 m");
      await expect(stats.locator("dd").nth(4)).toHaveText("25 m");
      await expect(stats.locator("dd").nth(5)).toHaveText("5 m");
      const map = page.getByRole("region", {
        name: labels.map.title,
        exact: true,
      });
      const elevationSection = page.getByRole("region", {
        name: labels.analytics.elevationChart,
        exact: true,
      });
      const speedSection = page.getByRole("region", {
        name: labels.analytics.speedChart,
        exact: true,
      });
      const description = page.getByRole("region", {
        name: labels.description,
        exact: true,
      });
      const tags = page.getByRole("region", { name: labels.tags, exact: true });
      const metadata = page.getByRole("region", {
        name: labels.metadata,
        exact: true,
      });
      await expect(map.locator('[aria-busy="false"]')).toBeVisible();
      await expect(description).toContainText(
        "First line\n<script>plain text</script>",
      );
      await expect(metadata).toContainText(labels.activities.hiking);
      await expect(metadata).toContainText(en ? "3 minutes" : "3 minutos");
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        const sections = [
          page.locator("article > header"),
          stats,
          map,
          elevationSection,
          speedSection,
          description,
          tags,
          metadata,
        ];
        const boxes = await Promise.all(
          sections.map((section) => section.boundingBox()),
        );
        for (let index = 1; index < boxes.length; index++)
          expect(boxes[index]!.y).toBeGreaterThanOrEqual(
            boxes[index - 1]!.y + boxes[index - 1]!.height,
          );
        const rows = await stats.evaluate(
          (element) =>
            new Set(
              Array.from(
                element.children,
                (child) => child.getBoundingClientRect().top,
              ),
            ).size,
        );
        expect(rows).toBe(width === 390 ? 3 : 1);
        if (width === 1280) {
          await expect(page.getByRole("main")).toHaveCSS("max-width", "1152px");
          const title = await page
            .getByRole("heading", { level: 1 })
            .boundingBox();
          const download = await page
            .getByRole("link", { name: labels.download, exact: true })
            .boundingBox();
          // Downloads stay within the map's tools panel at desktop widths.
          const tools = await page
            .getByRole("complementary", { name: labels.tools })
            .boundingBox();
          expect(download!.y).toBeGreaterThanOrEqual(tools!.y);
          expect(download!.y + download!.height).toBeLessThanOrEqual(
            tools!.y + tools!.height,
          );
          expect(download!.x).toBeGreaterThanOrEqual(tools!.x);
          expect(download!.x + download!.width).toBeLessThanOrEqual(
            tools!.x + tools!.width,
          );
          expect(
            title!.x + title!.width <= download!.x ||
              title!.y + title!.height <= download!.y,
          ).toBe(true);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const screenshot = testInfo.outputPath(`details-${width}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        await testInfo.attach(`details-${width}`, {
          path: screenshot,
          contentType: "image/png",
        });
      }
      await expect(
        speedSection.getByText(labels.analytics.speedHint, { exact: true }),
      ).toBeHidden();
      await speedSection.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(
        speedSection.getByText(labels.analytics.speedHint, { exact: true }),
      ).toBeVisible();
      await expect(
        map.getByText(labels.map.privacy, { exact: true }),
      ).toBeHidden();
      await map.getByText(labels.map.help, { exact: true }).click();
      await expect(
        map.getByText(labels.map.privacy, { exact: true }),
      ).toBeVisible();
      await expect(
        map.getByText(labels.map.interaction, { exact: true }),
      ).toBeVisible();
      const keyboardChart = elevationChart.locator('[tabindex="0"]');
      await expect(keyboardChart).toBeVisible();
      await keyboardChart.focus();
      await keyboardChart.press("ArrowRight");
      await expect(keyboardChart).toBeFocused();
      await expect(
        page.locator(".recharts-tooltip-wrapper").first(),
      ).toBeVisible();
      await expect(
        page.getByText(
          en
            ? /speed is an interval average/i
            : /La velocidad es un promedio del intervalo/i,
        ),
      ).toBeVisible();
      const elevationPath = await elevationChart
        .locator(".recharts-line-curve")
        .getAttribute("d");
      await selectTheme(page, theme === "dark" ? "light" : "dark");
      await expect(
        elevationChart.locator(".recharts-line-curve"),
      ).toHaveAttribute("d", elevationPath!);
      await expect(page.locator(".recharts-line-curve")).toHaveCount(2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    });
  }
}

test("interactive map retains the original recorded path and isolates provider failures", async ({
  context,
  page,
  baseURL,
}) => {
  await account(context, baseURL!);
  const id = await createAnalyticsTrack(context, baseURL!, gpx);
  await page.goto(`/en/tracks/${id}`);
  const map = page.getByRole("region", {
    name: "Recorded path map",
    exact: true,
  });
  await expect(
    map.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeVisible();
  expect(await mapCoordinates(page)).toEqual([
    [-3, 40],
    [-3.001, 40.001],
  ]);
  await expect(
    map.getByRole("img", { name: "Start", exact: true }),
  ).toBeVisible();
  await expect(
    map.getByRole("img", { name: "End", exact: true }),
  ).toBeVisible();
  await map.getByRole("img", { name: "Start", exact: true }).click();
  await map.getByRole("img", { name: "End", exact: true }).click();
  await expect(map.locator(".maplibregl-marker details")).toHaveCount(0);
  await expect(
    map.getByRole("link", { name: "OpenFreeMap", exact: true }),
  ).toBeVisible();
  await page.unroute("https://tiles.openfreemap.org/**");
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  await page.reload();
  await expect(page.locator('[data-slot="toast"]')).toContainText(
    enMessages.Tracks.map.outdoorFailure,
  );
  expect(await mapCoordinates(page)).toEqual([
    [-3, 40],
    [-3.001, 40.001],
  ]);
  const download = page.getByRole("link", { name: "Download GPX" });
  await expect(download).toBeVisible();
  const original = await context.request.get(
    (await download.getAttribute("href"))!,
  );
  expect(original.status()).toBe(200);
  expect(await original.body()).toEqual(gpx);
});

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} map controls, loop, dateline and theme stability`, async ({
      context,
      page,
      baseURL,
    }) => {
      const en = locale === "en";
      await account(context, baseURL!);
      const bytes = Buffer.from(
        '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg><trkpt lat="80" lon="179.9"/><trkpt lat="80" lon="179.9"/><trkpt lat="80.01" lon="-179.9"/><trkpt lat="80" lon="179.9"/></trkseg></trk></gpx>',
      );
      const id = await createAnalyticsTrack(context, baseURL!, bytes);
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}/tracks/${id}`);
      await selectTheme(page, theme);
      const map = page.getByRole("region", {
        name: en ? "Recorded path map" : "Mapa del trazado registrado",
        exact: true,
      });
      await expect(map.locator('[aria-busy="false"]')).toBeVisible();
      expect(await mapCoordinates(page)).toEqual([
        [179.9, 80],
        [179.9, 80],
        [180.1, 80.01],
        [179.9, 80],
      ]);
      await expect(map.locator(".maplibregl-marker")).toHaveCount(1);
      const marker = map.getByRole("img", {
        name: en ? "Start / end" : "Inicio / final",
        exact: true,
      });
      await expect(marker).toBeVisible();
      await marker.click();
      await expect(map.locator(".maplibregl-marker details")).toHaveCount(0);
      const canvas = map.locator("canvas");
      const rect = await canvas.boundingBox();
      const endpoint = await marker.boundingBox();
      expect(endpoint!.x).toBeGreaterThan(rect!.x);
      expect(endpoint!.x + endpoint!.width).toBeLessThan(rect!.x + rect!.width);
      const initialPosition = await map
        .locator(".maplibregl-marker")
        .getAttribute("style");
      await map
        .getByRole("button", { name: en ? "Zoom in" : "Ampliar", exact: true })
        .click();
      await expect(map.locator(".maplibregl-marker")).not.toHaveAttribute(
        "style",
        initialPosition!,
      );
      await map
        .getByRole("button", {
          name: en ? "Fit recorded path" : "Ajustar al trazado registrado",
        })
        .click();
      await expect(map.locator(".maplibregl-marker")).toHaveAttribute(
        "style",
        initialPosition!,
      );
      await canvas.hover();
      const scrollPosition = await page.evaluate(() => scrollY);
      await page.mouse.wheel(0, -300);
      await expect(map.locator(".maplibregl-marker")).not.toHaveAttribute(
        "style",
        initialPosition!,
      );
      expect(await page.evaluate(() => scrollY)).toBe(scrollPosition);
      await expect(map.locator(".maplibregl-cooperative-gestures")).toHaveCount(
        1,
      );
      await map
        .getByRole("button", {
          name: en ? "Fit recorded path" : "Ajustar al trazado registrado",
        })
        .click();
      await expect(map.locator(".maplibregl-marker")).toHaveAttribute(
        "style",
        initialPosition!,
      );
      // Pin the basemap so this isolates UI theme changes. Automatic basemap
      // switching legitimately restores sources when the map style changes.
      await map
        .getByRole("combobox", {
          name: en ? "Basemap" : "Mapa base",
          exact: true,
        })
        .selectOption("outdoor");
      await expect(map.locator('[aria-busy="false"]')).toBeVisible();
      const loads = await page.evaluate(() => window.recordedMapLoads);
      await selectTheme(page, theme === "dark" ? "light" : "dark");
      expect(await page.evaluate(() => window.recordedMapLoads)).toBe(loads);
      await expect(map.locator("canvas")).toHaveCount(1);
      await expect(
        map.getByRole("link", { name: "OpenFreeMap", exact: true }),
      ).toHaveCSS(
        "color",
        await map
          .locator(".maplibregl-ctrl-attrib")
          .evaluate((element) => getComputedStyle(element).color),
      );
      await map
        .getByRole("button", {
          name: en ? "Enter fullscreen" : "Entrar en pantalla completa",
        })
        .click();
      await expect(map.locator(":fullscreen")).toBeVisible();
      await expect(
        map.getByRole("link", { name: "OpenFreeMap", exact: true }),
      ).toBeVisible();
      await map
        .getByRole("button", {
          name: en ? "Exit fullscreen" : "Salir de pantalla completa",
        })
        .click();
      await expect(map.locator(":fullscreen")).toHaveCount(0);
      await canvas.focus();
      await page.keyboard.press("Tab");
      await expect(canvas).not.toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const basemap of ["outdoor", "dark", "topographic"] as const) {
      test(`${locale} ${theme} ${basemap} switching preserves the path, camera and controls`, async ({
        context,
        page,
        baseURL,
      }, testInfo) => {
        const en = locale === "en";
        await account(context, baseURL!);
        const id = await createAnalyticsTrack(context, baseURL!, gpx);
        if (theme === "dark")
          await page.setViewportSize({ width: 390, height: 844 });
        const outdoorRequests: string[] = [];
        const topographicRequests: string[] = [];
        const host =
          basemap !== "topographic"
            ? "https://tiles.openfreemap.org/outdoor-fixture/"
            : "https://tile.opentopomap.org/";
        const credits =
          basemap !== "topographic"
            ? ["OpenStreetMap", "OpenFreeMap", "OpenMapTiles"]
            : ["OpenStreetMap", "SRTM", "Sonny", "OpenTopoMap", "CC BY-SA 3.0"];
        const provider =
          basemap !== "topographic" ? "OpenFreeMap" : "OpenTopoMap";
        let geometryRequests = 0;
        page.on("request", (request) => {
          if (request.url().endsWith(`/api/tracks/${id}/data`))
            geometryRequests++;
          if (request.url().startsWith("https://tile.opentopomap.org/"))
            topographicRequests.push(request.url());
          if (request.url().startsWith(host)) {
            outdoorRequests.push(request.url());
            expect(request.headers().referer).toBeFalsy();
            expect(request.postData()).toBeNull();
            expect(request.url()).not.toContain(id);
          }
        });
        await page.goto(`/${locale}/tracks/${id}`);
        await selectTheme(page, theme);
        const map = page.getByRole("region", {
          name: en ? "Recorded path map" : "Mapa del trazado registrado",
          exact: true,
        });
        await expect(map.locator('[aria-busy="false"]')).toBeVisible();
        const coordinates = await mapCoordinates(page);
        const selector = map.getByRole("combobox", {
          name: en ? "Basemap" : "Mapa base",
          exact: true,
        });
        await expect(selector).toHaveValue(
          theme === "dark" ? "dark" : "outdoor",
        );
        if (basemap !== "topographic")
          await expect.poll(() => outdoorRequests.length).toBeGreaterThan(0);
        expect(topographicRequests).toHaveLength(0);
        await expect(
          selector.locator('option:not([value="satellite"])'),
        ).toHaveText(
          en
            ? ["Street", "Outdoors", "Dark", "Topographic"]
            : ["Callejero", "Aire libre", "Oscuro", "Topográfico"],
        );
        await map
          .getByRole("button", {
            name: en ? "Zoom in" : "Ampliar",
            exact: true,
          })
          .click();
        const position = await map
          .locator(".maplibregl-marker")
          .first()
          .getAttribute("style");
        const requestsBeforeSwitch = geometryRequests;
        await selector.selectOption("street");
        await expect(map.locator('[aria-busy="false"]')).toBeVisible();
        await selector.focus();
        await page.keyboard.press("ArrowDown");
        if (basemap !== "outdoor") await page.keyboard.press("ArrowDown");
        if (basemap === "topographic") await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await expect(selector).toHaveValue(basemap);
        await expect.poll(() => outdoorRequests.length).toBeGreaterThan(0);
        await expect(map.locator('[aria-busy="false"]')).toBeVisible();
        await expect(map.getByRole("alert")).toHaveCount(0);
        for (const name of credits) {
          await expect(
            map.getByRole("link", { name, exact: true }),
          ).toBeVisible();
        }
        expect(await mapCoordinates(page)).toEqual(coordinates);
        expect(geometryRequests).toBe(requestsBeforeSwitch);
        await expect(map.locator(".maplibregl-marker")).toHaveCount(2);
        await expect(map.locator(".maplibregl-marker").first()).toHaveAttribute(
          "style",
          position!,
        );
        await expect(map.locator("canvas")).toHaveCount(1);
        await expect(
          map.getByRole("link", { name: provider, exact: true }),
        ).toHaveCSS(
          "color",
          await map
            .locator(".maplibregl-ctrl-attrib")
            .evaluate((element) => getComputedStyle(element).color),
        );
        await map.screenshot({
          path: testInfo.outputPath(`${basemap}-map.png`),
        });
        if (basemap !== "topographic")
          expect(topographicRequests).toHaveLength(0);
        const loads = await page.evaluate(() => window.recordedMapLoads);
        await selectTheme(page, theme === "dark" ? "light" : "dark");
        await expect(selector).toHaveValue(basemap);
        expect(await page.evaluate(() => window.recordedMapLoads)).toBe(loads);
        await map
          .getByRole("button", {
            name: en ? "Enter fullscreen" : "Entrar en pantalla completa",
          })
          .click();
        await expect(map.locator(":fullscreen")).toBeVisible();
        await expect(selector).toBeVisible();
        await expect(
          map.getByRole("link", { name: provider, exact: true }),
        ).toBeVisible();
        await map
          .getByRole("button", {
            name: en ? "Exit fullscreen" : "Salir de pantalla completa",
          })
          .click();
        await selector.selectOption(
          basemap !== "topographic" ? "topographic" : "outdoor",
        );
        await expect(map.locator('[aria-busy="false"]')).toBeVisible();
        await expect(map.getByRole("alert")).toHaveCount(0);
        expect(await mapCoordinates(page)).toEqual(coordinates);
        await selector.selectOption("street");
        await expect(map.locator('[aria-busy="false"]')).toBeVisible();
        await expect(
          map.getByRole("link", { name: "OpenFreeMap", exact: true }),
        ).toBeVisible();
        await expect(
          map.getByRole("link", { name: "OpenTopoMap", exact: true }),
        ).toHaveCount(0);
        await expect(map.locator(".maplibregl-marker").first()).toHaveAttribute(
          "style",
          position!,
        );
        expect(await mapCoordinates(page)).toEqual(coordinates);
        expect(geometryRequests).toBe(requestsBeforeSwitch);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });
    }
  }
}

for (const [asset, pattern] of [
  ["tile", "https://tiles.openfreemap.org/outdoor-fixture/**"],
  ["source", "https://tiles.openfreemap.org/planet"],
  ["font", "https://tiles.openfreemap.org/fonts/**"],
  ["topographic", "https://tile.opentopomap.org/**"],
] as const) {
  test(`${asset === "topographic" ? "topographic tile" : `outdoor ${asset}`} failure leaves the path available and allows Street recovery and retry`, async ({
    context,
    page,
    baseURL,
  }) => {
    await account(context, baseURL!);
    const id = await createAnalyticsTrack(context, baseURL!, gpx);
    await page.goto(`/en/tracks/${id}`);
    const map = page.getByRole("region", {
      name: "Recorded path map",
      exact: true,
    });
    await expect(map.locator('[aria-busy="false"]')).toBeVisible();
    const coordinates = await mapCoordinates(page);
    const selector = map.getByRole("combobox", {
      name: "Basemap",
      exact: true,
    });
    let blockedRequests = 0;
    const target = asset === "topographic" ? "topographic" : "outdoor";
    const failTiles = (route: import("@playwright/test").Route) => {
      blockedRequests++;
      return route.abort();
    };
    await selector.selectOption("street");
    await expect(map.locator('[aria-busy="false"]')).toBeVisible();
    await page.route(pattern, failTiles);
    await selector.selectOption(target);
    await expect.poll(() => blockedRequests).toBeGreaterThan(0);
    if (asset === "font") {
      // The pinned renderer falls back to local glyph rendering on font failure.
      await expect(map.locator('[aria-busy="false"]')).toBeVisible();
      await expect(map.getByRole("alert")).toHaveCount(0);
    } else {
      await expect(page.locator('[data-slot="toast"]')).toContainText(
        asset === "topographic"
          ? "Topographic tiles could not be loaded"
          : "Outdoors tiles could not be loaded",
      );
      await page.locator('[data-slot="toast-close"]').click();
    }
    await expect(map.locator("canvas")).toBeVisible();
    await expect(map.locator(".maplibregl-marker")).toHaveCount(2);
    await expect(
      page.getByRole("link", { name: "Download GPX" }),
    ).toBeVisible();
    await selector.selectOption("street");
    await expect(map.locator('[aria-busy="false"]')).toBeVisible();
    await expect(map.getByRole("alert")).toHaveCount(0);
    await expect(
      map.getByRole("link", { name: "OpenFreeMap", exact: true }),
    ).toBeVisible();
    expect(await mapCoordinates(page)).toEqual(coordinates);
    await page.unroute(pattern, failTiles);
    await selector.selectOption(target);
    await expect(map.locator('[aria-busy="false"]')).toBeVisible();
    await expect(map.getByRole("alert")).toHaveCount(0);
    await expect(
      map.getByRole("link", {
        name: target === "topographic" ? "OpenTopoMap" : "OpenFreeMap",
        exact: true,
      }),
    ).toBeVisible();
  });
}

for (const basemap of ["outdoor", "topographic"] as const) {
  for (const recovery of [
    "street",
    basemap === "outdoor" ? "topographic" : "outdoor",
  ] as const) {
    test(`${basemap} timeout remains recoverable and late canceled tiles do not break ${recovery}`, async ({
      context,
      page,
      baseURL,
    }) => {
      await account(context, baseURL!);
      const id = await createAnalyticsTrack(context, baseURL!, gpx);
      await page.goto(`/en/tracks/${id}`);
      const map = page.getByRole("region", {
        name: "Recorded path map",
        exact: true,
      });
      await expect(map.locator('[aria-busy="false"]')).toBeVisible();
      await page.clock.install();
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let requests = 0;
      await page.route(
        basemap === "outdoor"
          ? "https://tiles.openfreemap.org/outdoor-fixture/**"
          : "https://tile.opentopomap.org/**",
        async (route) => {
          requests++;
          await pending;
          await route.abort();
        },
      );
      const selector = map.getByRole("combobox", {
        name: "Basemap",
        exact: true,
      });
      await selector.selectOption("street");
      await expect(map.locator('[aria-busy="false"]')).toBeVisible();
      await selector.selectOption(basemap);
      await expect.poll(() => requests).toBeGreaterThan(0);
      await page.clock.fastForward(26_000);
      await expect(page.locator('[data-slot="toast"]')).toContainText(
        basemap === "outdoor"
          ? "Outdoors tiles could not be loaded"
          : "Topographic tiles could not be loaded",
      );
      await page.locator('[data-slot="toast-close"]').click();
      await selector.selectOption(recovery);
      release();
      await expect(map.locator('[aria-busy="false"]')).toBeVisible();
      await expect(
        map.getByRole("link", {
          name: recovery === "topographic" ? "OpenTopoMap" : "OpenFreeMap",
          exact: true,
        }),
      ).toBeVisible();
      await expect(map.getByRole("alert")).toHaveCount(0);
      await expect(map.locator("canvas")).toBeVisible();
    });
  }
}

test("wheel zoom retains one-finger page scrolling and two-finger map panning on touch devices", async ({
  context,
  page,
  baseURL,
}) => {
  await account(context, baseURL!);
  const id = await createAnalyticsTrack(context, baseURL!, gpx);
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 2,
  });
  await page.goto(`/en/tracks/${id}`);
  const map = page.getByRole("region", {
    name: "Recorded path map",
    exact: true,
  });
  await expect(map.locator('[aria-busy="false"]')).toBeVisible();
  const canvas = map.locator("canvas");
  const marker = map.locator(".maplibregl-marker").first();
  await canvas.hover();
  const initialPosition = await marker.getAttribute("style");
  await page.mouse.wheel(0, -300);
  await expect(marker).not.toHaveAttribute("style", initialPosition!);
  await map.getByRole("button", { name: "Fit recorded path" }).click();
  await expect(marker).toHaveAttribute("style", initialPosition!);
  const swipe = async (fingers: number, deltaX: number, deltaY: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const rect = (await canvas.boundingBox())!;
    const x = rect.x + rect.width / 2 - 30;
    const y = rect.y + rect.height / 2 + 60;
    const touches = (step: number) =>
      Array.from({ length: fingers }, (_, id) => ({
        id,
        x: x + id * 60 + (deltaX * step) / 8,
        y: y + (deltaY * step) / 8,
      }));
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: touches(0),
    });
    for (let step = 1; step <= 8; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: touches(step),
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  await canvas.scrollIntoViewIfNeeded();
  const scrollPosition = await page.evaluate(() => scrollY);
  await swipe(1, 0, -120);
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(scrollPosition);
  await expect(marker).toHaveAttribute("style", initialPosition!);
  await swipe(2, 60, 0);
  await expect(marker).not.toHaveAttribute("style", initialPosition!);
  await cdp.detach();
});

test("client navigation releases map resources and restores the correct Track geometry", async ({
  context,
  page,
  baseURL,
}) => {
  await account(context, baseURL!);
  const id = await createAnalyticsTrack(context, baseURL!, gpx);
  await page.goto(`/en/tracks/${id}`);
  const readyMap = page.locator('.track-map[aria-busy="false"]:visible');
  const visibleCanvas = page.locator(".track-map canvas:visible");
  await expect(readyMap).toBeVisible();
  expect(await mapCoordinates(page)).toEqual([
    [-3, 40],
    [-3.001, 40.001],
  ]);
  const selector = readyMap.getByRole("combobox", {
    name: "Basemap",
    exact: true,
  });
  await expect(selector).toHaveValue("outdoor");
  await selector.selectOption("street");
  await expect(readyMap).toBeVisible();
  const workerCount = await page.evaluate(() => window.activeMapWorkers ?? 0);
  expect(workerCount).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Upload another track" }).click();
  await expect(page).toHaveURL(/\/en\/tracks\/upload$/);
  await expect(visibleCanvas).toHaveCount(0);
  // MapLibre 5.24 keeps a single shared worker for its global RTL dispatcher.
  // Per-map sources must be released, and the pool must not grow on navigation.
  await expect
    .poll(() => page.evaluate(() => window.removedWorkerMaps ?? 0))
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(() => window.activeMapWorkers ?? 0),
  ).toBeLessThanOrEqual(workerCount);
  await page.goBack();
  await expect(readyMap).toBeVisible();
  await expect(selector).toHaveValue("street");
  await selectLanguage(page, "Español");
  await expect(page).toHaveURL(`/es/tracks/${id}`);
  await expect(readyMap).toBeVisible();
  await expect(visibleCanvas).toHaveCount(1);
  expect(await mapCoordinates(page)).toEqual([
    [-3, 40],
    [-3.001, 40.001],
  ]);
  expect(await page.evaluate(() => window.activeMapWorkers)).toBe(workerCount);
  await expect(
    page.getByRole("region", {
      name: "Mapa del trazado registrado",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Descripción", exact: true }),
  ).toBeVisible();
  const headingIds = await page
    .locator("article h2[id]")
    .evaluateAll((elements) => elements.map((element) => element.id));
  expect(new Set(headingIds).size).toBe(headingIds.length);
  const removed = await page.evaluate(() => window.removedWorkerMaps ?? 0);
  await page.getByRole("link", { name: "Subir otro recorrido" }).click();
  await expect
    .poll(() => page.evaluate(() => window.removedWorkerMaps ?? 0))
    .toBeGreaterThan(removed);
  const bytes = Buffer.from(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg><trkpt lat="45" lon="2"/><trkpt lat="45.01" lon="2.01"/><trkpt lat="45.02" lon="2.03"/></trkseg></trk></gpx>',
  );
  await fillTrack(page, false, bytes);
  await page
    .getByRole("button", { name: "Subir recorrido", exact: true })
    .click();
  await expect(page).toHaveURL(/\/es\/tracks\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toContain(id);
  await expect(readyMap).toBeVisible();
  expect(await mapCoordinates(page)).toEqual([
    [2, 45],
    [2.01, 45.01],
    [2.03, 45.02],
  ]);
  await expect(visibleCanvas).toHaveCount(1);
  expect(await page.evaluate(() => window.activeMapWorkers)).toBe(workerCount);
});

for (const fault of [
  "unauthorized geometry",
  "malformed geometry",
  "worker",
  "library",
  "WebGL",
] as const) {
  test(`map ${fault} failure is contained and retryable`, async ({
    context,
    page,
    baseURL,
  }) => {
    await account(context, baseURL!);
    const id = await createAnalyticsTrack(context, baseURL!, gpx);
    if (fault === "unauthorized geometry")
      await page.route(`**/api/tracks/${id}/data`, (route) =>
        route.fulfill({ status: 404, json: { error: "notFound" } }),
      );
    if (fault === "malformed geometry")
      await page.route(`**/api/tracks/${id}/data`, (route) =>
        route.fulfill({
          json: {
            geometry: {
              type: "MultiLineString",
              coordinates: [
                [
                  [null, 4],
                  [1, 2],
                ],
              ],
            },
          },
        }),
      );
    if (fault === "library")
      await page.route("**/*maplibre*.js", (route) => route.abort());
    if (fault === "worker")
      await page.addInitScript(() => {
        if (sessionStorage.getItem("test-map-workers-restored") === "true")
          return;
        const Original = window.Worker;
        window.Worker = class extends Original {
          constructor(url: string | URL, options?: WorkerOptions) {
            if (String(url).startsWith("blob:"))
              throw Error("Worker unavailable");
            super(url, options);
          }
        };
      });
    await page.goto(`/en/tracks/${id}`);
    const map = page.getByRole("region", {
      name: "Recorded path map",
      exact: true,
    });
    if (fault === "worker") {
      await expect(page.locator('[data-slot="toast"]')).toContainText(
        enMessages.Tracks.map.outdoorFailure,
      );
      // Initial worker failure prevents loading, so the basemap cannot be changed.
      await expect(
        map.getByRole("combobox", { name: enMessages.Tracks.map.basemap }),
      ).toBeDisabled();
    }
    if (fault === "WebGL") {
      await expect(map.locator('[aria-busy="false"]')).toBeVisible();
      await map.locator("canvas").dispatchEvent("webglcontextlost");
    }
    if (fault !== "worker")
      await expect(map.getByRole("alert")).toContainText(
        enMessages.Tracks.map.failure,
      );
    await expect(
      page.getByRole("heading", { name: "Analytics fixture" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download GPX" }),
    ).toBeVisible();
    if (fault === "worker") {
      const original = await context.request.get(`/api/tracks/${id}/download`);
      expect(original.status()).toBe(200);
      expect(await original.body()).toEqual(gpx);
      await page.evaluate(() =>
        sessionStorage.setItem("test-map-workers-restored", "true"),
      );
      await page.reload();
      await expect(map.locator('[aria-busy="false"]')).toBeVisible();
      await expect(map.getByRole("alert")).toHaveCount(0);
      expect(await mapCoordinates(page)).toEqual([
        [-3, 40],
        [-3.001, 40.001],
      ]);
    } else {
      await page.unroute(`**/api/tracks/${id}/data`);
      await page.unroute("**/*maplibre*.js");
      await map.getByRole("button", { name: "Reload map" }).click();
      await expect(map.locator('[aria-busy="false"]')).toBeVisible();
    }
  });
}

test("live hosted basemap integration keeps recording data same-origin", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  test.skip(
    process.env.RUN_LIVE_BASEMAP !== "1",
    "Explicit provider integration check",
  );
  test.setTimeout(90_000);
  await account(context, baseURL!);
  const bytes = Buffer.from(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg><trkpt lat="42.64" lon="-0.05"/><trkpt lat="42.65" lon="-0.055"/><trkpt lat="42.655" lon="-0.06"/></trkseg></trk></gpx>',
  );
  const id = await createAnalyticsTrack(context, baseURL!, bytes);
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().startsWith("https://tiles.openfreemap.org/") ||
      request.url().startsWith("https://tile.opentopomap.org/")
    ) {
      external.push(request.url());
      expect(request.postData()).toBeNull();
      expect(request.headers().referer).toBeFalsy();
      expect(request.url()).not.toContain(id);
    }
  });
  await page.goto(`/en/tracks/${id}`);
  const map = page.getByRole("region", {
    name: "Recorded path map",
    exact: true,
  });
  await expect(map.locator('[aria-busy="false"]')).toBeVisible({
    timeout: 45_000,
  });
  await expect(
    map.getByRole("link", { name: "OpenStreetMap", exact: true }),
  ).toBeVisible();
  await expect.poll(() => external.length).toBeGreaterThan(3);
  await expect(map.getByRole("alert")).toHaveCount(0);
  const coordinates = await mapCoordinates(page);
  await map
    .getByRole("combobox", { name: "Basemap", exact: true })
    .selectOption("outdoor");
  await expect
    .poll(() => external.filter((url) => /\/planet\/.+\.pbf$/.test(url)).length)
    .toBeGreaterThan(0);
  await expect(map.locator('[aria-busy="false"]')).toBeVisible({
    timeout: 45_000,
  });
  await expect(
    map.getByRole("link", { name: "OpenFreeMap", exact: true }),
  ).toBeVisible();
  await expect(map.getByRole("alert")).toHaveCount(0);
  expect(await mapCoordinates(page)).toEqual(coordinates);
  await map.screenshot({ path: testInfo.outputPath("live-outdoor.png") });
  expect(external.some((url) => url.includes("opentopomap.org"))).toBe(false);
  await map
    .getByRole("combobox", { name: "Basemap", exact: true })
    .selectOption("topographic");
  await expect
    .poll(
      () =>
        external.filter((url) =>
          url.startsWith("https://tile.opentopomap.org/"),
        ).length,
    )
    .toBeGreaterThan(0);
  await expect(map.locator('[aria-busy="false"]')).toBeVisible({
    timeout: 45_000,
  });
  await expect(map.getByRole("alert")).toHaveCount(0);
  await expect(
    map.getByRole("link", { name: "OpenTopoMap", exact: true }),
  ).toBeVisible();
  expect(await mapCoordinates(page)).toEqual(coordinates);
  await map.screenshot({ path: testInfo.outputPath("live-topographic.png") });
});

async function createAnalyticsTrack(
  context: BrowserContext,
  baseURL: string,
  bytes: Buffer,
) {
  const response = await context.request.post("/api/tracks", {
    headers: {
      origin:
        process.env.E2E_SERVER_MODE === "production"
          ? baseURL.replace("http:", "https:")
          : baseURL,
    },
    multipart: {
      name: "Analytics fixture",
      description: "Recorded analytics fixture",
      activity: "hiking",
      difficulty: "3",
      tags: JSON.stringify(["analytics"]),
      requestId: randomUUID(),
      file: {
        name: "analytics.gpx",
        mimeType: "application/gpx+xml",
        buffer: bytes,
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).id as string;
}

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} partial chart gaps and lazy-library failure isolation`, async ({
      context,
      page,
      baseURL,
    }) => {
      test.skip(
        !!process.env.TEST_BASE_URL,
        "Requires isolated local storage harness",
      );
      const en = locale === "en";
      await account(context, baseURL!);
      const id = await createAnalyticsTrack(
        context,
        baseURL!,
        Buffer.from(
          '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test"><trk><trkseg><trkpt lat="40" lon="-3"><ele>10</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="40.001" lon="-3.001"><ele>20</ele><time>2026-01-01T00:01:00Z</time></trkpt><trkpt lat="40.002" lon="-3.002"/><trkpt lat="40.003" lon="-3.003"><ele>5</ele><time>2026-01-01T00:03:00Z</time></trkpt><trkpt lat="40.004" lon="-3.004"><ele>30</ele><time>2026-01-01T00:04:00Z</time></trkpt></trkseg></trk></gpx>',
        ),
      );
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}/tracks/${id}`);
      await selectTheme(page, theme);
      const analytics = page.getByRole("region", {
        name: en ? "Recorded analytics" : "Estadísticas registradas",
      });
      await expect(analytics).toContainText(
        en
          ? "Partial elevation coverage: 4 of 5 points"
          : "Cobertura de altitud parcial: 4 de 5 puntos",
      );
      await expect(
        analytics.getByText(en ? "Unavailable" : "No disponible", {
          exact: true,
        }),
      ).toHaveCount(2);
      const range = page
        .getByLabel(en ? "Main statistics" : "Estadísticas principales", {
          exact: true,
        })
        .locator("dt")
        .filter({
          hasText: new RegExp(
            `^${(en ? enMessages : esMessages).Tracks.analytics.range}$`,
          ),
        })
        .locator("+ dd");
      await expect(range).toContainText("25 m");
      await expect(range).toContainText(
        en ? "Partial data" : "Datos parciales",
      );
      const curves = page.locator(".recharts-line-curve");
      await expect(curves).toHaveCount(2);
      for (const curve of await curves.all()) {
        expect((await curve.getAttribute("d"))?.match(/M/g)).toHaveLength(2);
      }
      await expect(
        page.getByRole("link", {
          name: en ? "Download GPX" : "Descargar GPX",
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const keyboardChart = analytics
        .getByRole("group", {
          name: new RegExp(
            en
              ? "Elevation by recorded distance"
              : "Altitud según la distancia registrada",
          ),
        })
        .locator('[tabindex="0"]');
      await keyboardChart.focus();
      for (let index = 0; index < 5; index++)
        await keyboardChart.press("ArrowLeft");
      await keyboardChart.press("ArrowRight");
      await keyboardChart.press("ArrowRight");
      await expect(
        analytics.getByRole("status").filter({
          hasText: en ? "No recorded value" : "Sin valor registrado",
        }),
      ).toBeVisible();
      // A real failed script request must be contained by the chart boundary.
      await page.route("**/*recharts*.js", (route) => route.abort("failed"));
      await page.reload();
      await expect(
        page.getByRole("alert").filter({
          hasText: en
            ? "Charts could not be loaded"
            : "No se pudieron cargar las gráficas",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Analytics fixture" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", {
          name: en ? "Download GPX" : "Descargar GPX",
        }),
      ).toBeVisible();
      await page.unroute("**/*recharts*.js");
      await page
        .getByRole("button", {
          name: en ? "Reload track details" : "Volver a cargar los detalles",
        })
        .click();
      await expect(page.locator(".recharts-line-curve")).toHaveCount(2);
      // Inject malformed chart data only into this test-owned recording to
      // exercise the server-side data failure boundary, without a test bypass.
      const originalData = await context.request.get(`/api/tracks/${id}/data`);
      const { samples } = await originalData.json();
      await pool.query(
        "UPDATE track_data SET samples=$2::jsonb WHERE track_id=$1",
        [id, JSON.stringify(samples.map(() => null))],
      );
      await page.reload();
      await expect(
        page.getByRole("status").filter({
          hasText: en
            ? "Charts could not be loaded"
            : "No se pudieron cargar las gráficas",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Analytics fixture" }),
      ).toBeVisible();
      const download = await context.request.get(`/api/tracks/${id}/download`);
      expect(download.status()).toBe(200);
      await pool.query(
        "UPDATE track_data SET samples=$2::jsonb WHERE track_id=$1",
        [id, JSON.stringify(samples)],
      );
      await page
        .getByRole("link", {
          name: en ? "Reload track details" : "Volver a cargar los detalles",
        })
        .click();
      await expect(page.locator(".recharts-line-curve")).toHaveCount(2);
    });
  }
}

test("100,000 recorded points render bounded charts and responsive keyboard tooltips", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    !!process.env.TEST_BASE_URL,
    "Requires isolated local storage harness",
  );
  await account(context, baseURL!);
  const buffer = Buffer.alloc(10 * 1024 * 1024);
  let offset = buffer.write(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg>',
  );
  for (let index = 0; index < 100_000; index++) {
    const time = new Date(Date.UTC(2024, 0, 1) + index * 1000)
      .toISOString()
      .replace(".000Z", "Z");
    offset += buffer.write(
      `<trkpt lat="${(48 + index * 0.000001).toFixed(6)}" lon="${(2 + index * 0.000002).toFixed(6)}"><ele>${100 + (index % 20)}</ele><time>${time}</time></trkpt>`,
      offset,
    );
  }
  offset += buffer.write("</trkseg></trk></gpx>", offset);
  const id = await createAnalyticsTrack(
    context,
    baseURL!,
    buffer.subarray(0, offset),
  );
  const started = performance.now();
  const mapResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/tracks/${id}/data`),
  );
  const response = await page.goto(`/en/tracks/${id}`);
  await expect(page.locator(".recharts-line-curve")).toHaveCount(2);
  const renderedMilliseconds = Math.round(performance.now() - started);
  const map = page.getByRole("region", {
    name: "Recorded path map",
    exact: true,
  });
  await expect(map.locator('[aria-busy="false"]')).toBeVisible();
  const coordinates = await mapCoordinates(page);
  expect(coordinates).toHaveLength(100_000);
  expect(
    coordinates.every(
      ([lon, lat], index) =>
        lon === Number((2 + index * 0.000002).toFixed(6)) &&
        lat === Number((48 + index * 0.000001).toFixed(6)),
    ),
  ).toBe(true);
  const mapRenderedMilliseconds = Math.round(performance.now() - started);
  const mapInteractionStarted = performance.now();
  await map.getByRole("button", { name: "Zoom in", exact: true }).click();
  await map.getByRole("button", { name: "Fit recorded path" }).click();
  const mapInteractionMilliseconds = Math.round(
    performance.now() - mapInteractionStarted,
  );
  expect(mapInteractionMilliseconds).toBeLessThan(2000);
  await map
    .getByRole("combobox", { name: "Basemap", exact: true })
    .selectOption("outdoor");
  await expect(map.locator('[aria-busy="false"]')).toBeVisible();
  expect(await mapCoordinates(page)).toEqual(coordinates);
  await map
    .getByRole("combobox", { name: "Basemap", exact: true })
    .selectOption("topographic");
  await expect(map.locator('[aria-busy="false"]')).toBeVisible();
  expect(await mapCoordinates(page)).toEqual(coordinates);
  await expect(map.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByText(
      "Chart display is reduced for responsiveness; extrema and data gaps are retained.",
      { exact: true },
    ),
  ).toHaveCount(1);
  const speedSections = page.getByRole("region", {
    name: "Average speed by recorded distance",
  });
  await expect(speedSections.getByText("Chart section 1 / 126")).toBeVisible();
  await speedSections.getByRole("button", { name: "Next section" }).click();
  await expect(speedSections.getByText("Chart section 2 / 126")).toBeVisible();
  const keyboardChart = page
    .getByRole("group", { name: /Elevation by recorded distance/ })
    .locator('[tabindex="0"]');
  const interactionStarted = performance.now();
  await keyboardChart.focus();
  await keyboardChart.press("ArrowRight");
  await expect(page.locator(".recharts-tooltip-wrapper").first()).toBeVisible();
  const interactionMilliseconds = Math.round(
    performance.now() - interactionStarted,
  );
  const metrics = await page.evaluate(() => ({
    svgElements: document.querySelectorAll("svg *").length,
    points: document.querySelectorAll(".recharts-line-dot").length,
  }));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const performanceMetrics = await cdp.send("Performance.getMetrics");
  const heapBytes = performanceMetrics.metrics.find(
    (metric) => metric.name === "JSHeapUsedSize",
  )?.value;
  await cdp.detach();
  await response!.finished();
  const documentBytes = await page.evaluate(
    () =>
      (
        performance.getEntriesByType(
          "navigation",
        )[0] as PerformanceNavigationTiming
      ).decodedBodySize,
  );
  const benchmark = {
    originalPoints: 100_000,
    gpxBytes: offset,
    documentBytes,
    renderedMilliseconds,
    mapRenderedMilliseconds,
    mapInteractionMilliseconds,
    mapDataBytes: (await (await mapResponse).body()).length,
    interactionMilliseconds,
    heapBytes,
    ...metrics,
  };
  console.info("Track chart benchmark", JSON.stringify(benchmark));
  await testInfo.attach("track-chart-benchmark", {
    body: JSON.stringify(benchmark),
    contentType: "application/json",
  });
  expect(metrics.svgElements).toBeLessThan(500);
  expect(interactionMilliseconds).toBeLessThan(2000);
});

test("fragmented 100,000-point elevation remains inspectable in bounded sections", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    !!process.env.TEST_BASE_URL,
    "Requires isolated local storage harness",
  );
  await account(context, baseURL!);
  const buffer = Buffer.alloc(10 * 1024 * 1024);
  let offset = buffer.write(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg>',
  );
  for (let index = 0; index < 100_000; index++) {
    offset += buffer.write(
      `<trkpt lat="${(48 + index * 0.000001).toFixed(6)}" lon="${(2 + index * 0.000002).toFixed(6)}">${index % 2 === 0 ? `<ele>${100 + (index % 20)}</ele>` : ""}</trkpt>`,
      offset,
    );
  }
  offset += buffer.write("</trkseg></trk></gpx>", offset);
  const id = await createAnalyticsTrack(
    context,
    baseURL!,
    buffer.subarray(0, offset),
  );
  const started = performance.now();
  const response = await page.goto(`/en/tracks/${id}`);
  const elevation = page.getByRole("region", {
    name: "Elevation by recorded distance",
  });
  const nextSection = elevation.getByRole("button", { name: "Next section" });
  await expect(nextSection).toBeVisible();
  // Server-rendered section controls intentionally remain disabled until
  // hydration. Include that readiness in render time, before timing interaction.
  await expect(nextSection).toBeEnabled();
  const renderedMilliseconds = Math.round(performance.now() - started);
  await expect(
    elevation.getByRole("status").filter({ hasText: "Chart section" }),
  ).toContainText("1 / 63");
  const interactionStarted = performance.now();
  await nextSection.click();
  await expect(
    elevation.getByRole("status").filter({ hasText: "Chart section" }),
  ).toContainText("2 / 63");
  const interactionMilliseconds = Math.round(
    performance.now() - interactionStarted,
  );
  const metrics = await page.evaluate(() => ({
    svgElements: document.querySelectorAll("svg *").length,
    isolatedDots: document.querySelectorAll('[data-slot="chart"] circle')
      .length,
  }));
  await response!.finished();
  const documentBytes = await page.evaluate(
    () =>
      (
        performance.getEntriesByType(
          "navigation",
        )[0] as PerformanceNavigationTiming
      ).decodedBodySize,
  );
  console.info(
    "Fragmented chart benchmark",
    JSON.stringify({
      originalPoints: 100_000,
      gpxBytes: offset,
      documentBytes,
      renderedMilliseconds,
      interactionMilliseconds,
      ...metrics,
    }),
  );
  await testInfo.attach("fragmented-chart-benchmark", {
    body: JSON.stringify({
      renderedMilliseconds,
      interactionMilliseconds,
      ...metrics,
    }),
    contentType: "application/json",
  });
  expect(metrics.svgElements).toBeLessThan(2000);
  expect(metrics.isolatedDots).toBeGreaterThan(700);
  expect(interactionMilliseconds).toBeLessThan(2000);

  // A later empty section must not claim that the entire recording lacks data.
  let elevationCount = 0;
  const sparseBytes = Buffer.from(
    buffer
      .subarray(0, offset)
      .toString()
      .replace(/<ele>[^<]*<\/ele>/g, (elevation) =>
        // Keep known values inside section one, before its overlapping tail.
        elevationCount++ < 750 ? elevation : "",
      ),
  );
  const sparseId = await createAnalyticsTrack(context, baseURL!, sparseBytes);
  await page.goto(`/en/tracks/${sparseId}`);
  const sparseChart = page.getByRole("region", {
    name: "Elevation by recorded distance",
  });
  await sparseChart.getByRole("button", { name: "Next section" }).click();
  await expect(sparseChart).toContainText(
    "No recorded values in this chart section",
  );
  await expect(sparseChart).not.toContainText(
    "this recording has no elevation samples",
  );
});

test("real HTTP server accepts a valid GPX multipart upload", async ({
  context,
  baseURL,
}) => {
  await account(context, baseURL!);
  const response = await context.request.post("/api/tracks", {
    headers: { origin: baseURL! },
    multipart: {
      name: "HTTP track",
      description: "Two positions",
      activity: "hiking",
      difficulty: "3",
      tags: JSON.stringify(["forest"]),
      requestId: randomUUID(),
      file: { name: "track.gpx", mimeType: "application/gpx+xml", buffer: gpx },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
});
for (const locale of ["en", "es"]) {
  const en = locale === "en";
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} keyboard validation, retry retention and private original`, async ({
      page,
      context,
      request,
      baseURL,
    }) => {
      test.skip(
        !!process.env.TEST_BASE_URL,
        "Requires isolated local storage harness",
      );
      await account(context, baseURL!);
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}`);
      await selectTheme(page, theme);
      await page.getByRole("button", { name: "Ada L.", exact: true }).click();
      await page
        .getByRole("menuitem", {
          name: en ? "Upload track" : "Subir recorrido",
        })
        .click();
      const submit = page.getByRole("button", {
        name: en ? "Upload track" : "Subir recorrido",
        exact: true,
      });
      await expect(submit).toBeDisabled();
      await page
        .getByLabel(en ? "Name" : "Nombre", { exact: true })
        .fill("Validation preview");
      await page
        .getByLabel(en ? "GPX file" : "Archivo GPX", { exact: true })
        .setInputFiles({
          name: "preview.gpx",
          mimeType: "application/gpx+xml",
          buffer: gpx,
        });
      await submit.click();
      await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
      await expect(
        page.getByRole("radiogroup", {
          name: en ? "Activity type" : "Tipo de actividad",
        }),
      ).toHaveAttribute("aria-invalid", "true");
      await expect(
        page.getByRole("radio", { name: "1", exact: true }),
      ).not.toBeChecked();
      await fillTrack(page, en);
      await expect(
        page.getByRole("radio", {
          name: en ? "Private" : "Privado",
          exact: true,
        }),
      ).toBeChecked();
      await expect(
        page.getByRole("radio", {
          name: en ? "Public" : "Público",
          exact: true,
        }),
      ).not.toBeChecked();
      await expect(
        page.getByRole("status").filter({
          hasText: en ? "Added High ridge." : "Se ha añadido High ridge.",
        }),
      ).toBeVisible();
      const tags = page.getByLabel(en ? "Tags" : "Etiquetas", { exact: true });
      await tags.fill("ＨＩＧＨ ridge");
      await tags.press("Enter");
      await expect(
        page.getByText(
          en ? "This tag is already added." : "Esta etiqueta ya está añadida.",
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: en ? "Remove High ridge" : "Eliminar High ridge",
          exact: true,
        }),
      ).toHaveCount(1);
      await tags.fill("Coastal views");
      await tags.press("Enter");
      await page
        .getByRole("button", {
          name: en ? "Remove Coastal views" : "Eliminar Coastal views",
        })
        .click();
      await expect(tags).toBeFocused();
      await expect(
        page.getByRole("status").filter({
          hasText: en
            ? "Removed Coastal views."
            : "Se ha eliminado Coastal views.",
        }),
      ).toBeVisible();
      // Lose the first response after real publication, then retry through the same public HTTP boundary.
      let firstRequestId: string | undefined;
      let retryRequestId: string | undefined;
      let attempt = 0;
      await page.route("**/api/tracks", async (route) => {
        const body = route.request().postDataBuffer()!.toString();
        const id = body.match(/name="requestId"\r\n\r\n([^\r]+)/)?.[1];
        attempt++;
        if (attempt === 1) {
          firstRequestId = id;
          const response = await route.fetch();
          expect(response.status(), await response.text()).toBe(201);
          await route.abort("failed");
        } else {
          retryRequestId = id;
          await route.continue();
        }
      });
      await submit.click();
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        en ? "temporarily unavailable" : "no está disponible temporalmente",
      );
      await expect(
        page.getByLabel(en ? "Name" : "Nombre", { exact: true }),
      ).toHaveValue("Private ridge");
      await expect(
        page.getByLabel(en ? "GPX file" : "Archivo GPX"),
      ).not.toBeEmpty();
      await submit.click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/tracks/[0-9a-f-]{36}$`),
      );
      expect(firstRequestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(retryRequestId).toBe(firstRequestId);
      const analytics = page.getByRole("region", {
        name: en ? "Recorded analytics" : "Estadísticas registradas",
      });
      await expect(analytics).toBeVisible();
      await expect(
        analytics.getByText(en ? "Unavailable" : "No disponible", {
          exact: true,
        }),
      ).toHaveCount(3);
      await expect(analytics).toContainText(
        en ? "No recorded elevation samples" : "No hay muestras de altitud",
      );
      await expect(
        analytics.getByRole("heading", {
          name: en
            ? "Elevation by recorded distance"
            : "Altitud según la distancia registrada",
        }),
      ).toBeVisible();
      await expect(analytics).toContainText(
        en
          ? "no usable timed intervals"
          : "no contiene intervalos con tiempos válidos",
      );
      await expect(analytics.locator(".recharts-line-curve")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await expect(
        page.getByRole("heading", { name: "Private ridge" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("article")
          .getByText("<script>plain text</script>", { exact: false }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("article")
          .getByText(en ? "Private" : "Privado", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("main")).toContainText("Ada L.");
      await expect(page.getByRole("main")).toContainText(
        en ? "Hiking" : "Senderismo",
      );
      await expect(page.getByRole("main")).toContainText("3 / 5");
      await expect(page.getByRole("main")).toContainText("High ridge");
      await expect(page).toHaveTitle(
        en
          ? "Track details — Track Atlas"
          : "Detalles del recorrido — Track Atlas",
      );
      expect(await page.locator("head").textContent()).not.toContain(
        "Private ridge",
      );
      const download = page.getByRole("link", {
        name: en ? "Download GPX" : "Descargar GPX",
      });
      const url = (await download.getAttribute("href"))!;
      const original = await context.request.get(url);
      expect(original.status()).toBe(200);
      expect(await original.body()).toEqual(gpx);
      expect(original.headers()["cache-control"]).toBe("private, no-store");
      const detailsURL = page.url();
      expect((await request.get(url)).status()).toBe(401);
      await account(context, baseURL!);
      expect((await context.request.get(url)).status()).toBe(404);
      await page.goto(detailsURL);
      await expect(
        page.getByRole("heading", {
          name: en ? "Track not found" : "Recorrido no encontrado",
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
  test(`${locale} recoverable HTTP errors retain input and changed payload gets a fresh request`, async ({
    page,
    context,
    baseURL,
  }) => {
    await account(context, baseURL!);
    await page.goto(`/${locale}/tracks/upload`);
    await fillTrack(page, en);
    await expect(
      page.getByLabel(en ? "Name" : "Nombre", { exact: true }),
    ).toHaveValue("Private ridge");
    await expect(
      page.getByRole("radio", { name: "3", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole("radio", {
        name: en ? "Hiking" : "Senderismo",
        exact: true,
      }),
    ).toBeChecked();
    const ids: string[] = [];
    const replies = [
      { status: 422, body: { error: "unsupportedStructure" } },
      { status: 409, body: { error: "processing" } },
      {
        status: 422,
        body: { error: "invalidMetadata", fieldErrors: { name: "tooLong" } },
      },
      { status: 403, body: { error: "emailUnconfirmed" } },
      { status: 401, body: { error: "unauthorized" } },
    ];
    await page.route("**/api/tracks", async (route) => {
      ids.push(
        route
          .request()
          .postDataBuffer()!
          .toString()
          .match(/name="requestId"\r\n\r\n([^\r]+)/)![1],
      );
      const reply = replies[ids.length - 1];
      await route.fulfill({
        status: reply.status,
        contentType: "application/json",
        body: JSON.stringify(reply.body),
      });
    });
    const submit = page.getByRole("button", {
      name: en ? "Upload track" : "Subir recorrido",
      exact: true,
    });
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      (en ? enMessages : esMessages).Tracks.errors.unsupportedStructure,
    );
    await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
    await expect(
      page.getByLabel(en ? "Description" : "Descripción", { exact: true }),
    ).toHaveValue("First line\n<script>plain text</script>");
    await expect(
      page.getByRole("radio", {
        name: en ? "Hiking" : "Senderismo",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      page.getByRole("radio", { name: "3", exact: true }),
    ).toBeChecked();
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "still processing" : "sigue en proceso",
    );
    expect(ids[1]).toBe(ids[0]);
    await expect(
      page.getByLabel(en ? "Name" : "Nombre", { exact: true }),
    ).toBeDisabled();
    await submit.click();
    await expect(
      page.getByLabel(en ? "Name" : "Nombre", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(ids[2]).toBe(ids[0]);
    await page
      .getByLabel(en ? "Name" : "Nombre", { exact: true })
      .fill("Changed ridge");
    await submit.click();
    expect(ids[3]).not.toBe(ids[0]);
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "Confirm your email" : "Confirma tu correo",
    );
    await expect(
      page
        .getByRole("main")
        .getByRole("alert")
        .getByRole("link", {
          name: en ? "Account settings" : "Ajustes de la cuenta",
        }),
    ).toBeVisible();
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "session expired" : "sesión ha caducado",
    );
    expect(ids[4]).toBe(ids[3]);
  });
  test(`${locale} required text and tag limits count Unicode characters`, async ({
    page,
    context,
    baseURL,
  }) => {
    await account(context, baseURL!);
    await page.goto(`/${locale}/tracks/upload`);
    await fillTrack(page, en);
    let submissions = 0;
    await page.route("**/api/tracks", async (route) => {
      submissions++;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "unavailable" }),
      });
    });
    const name = page.getByLabel(en ? "Name" : "Nombre", { exact: true });
    const description = page.getByLabel(en ? "Description" : "Descripción", {
      exact: true,
    });
    const tags = page.getByLabel(en ? "Tags" : "Etiquetas", { exact: true });
    const submit = page.getByRole("button", {
      name: en ? "Upload track" : "Subir recorrido",
      exact: true,
    });
    await name.fill("🥾".repeat(201));
    await description.fill("🌲".repeat(5001));
    await expect(submit).toBeDisabled();
    await expect(
      page
        .getByRole("region", {
          name: en ? "Upload preview" : "Vista previa de la subida",
        })
        .getByRole("alert"),
    ).toHaveText((en ? enMessages : esMessages).Tracks.errors.invalidMetadata);
    expect(submissions).toBe(0);
    await tags.fill("🌲".repeat(31));
    await tags.press("Enter");
    await expect(tags).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("button", {
        name: `${en ? "Remove" : "Eliminar"} ${"🌲".repeat(31)}`,
        exact: true,
      }),
    ).toHaveCount(0);
    await tags.fill("🌲".repeat(30));
    await tags.press("Enter");
    await expect(
      page.getByRole("button", {
        name: `${en ? "Remove" : "Eliminar"} ${"🌲".repeat(30)}`,
        exact: true,
      }),
    ).toBeVisible();
    for (let index = 1; index <= 8; index++) {
      await tags.fill(`Tag ${index}`);
      await tags.press("Enter");
    }
    await tags.fill("An eleventh tag");
    await tags.press("Enter");
    await expect(tags).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("button", {
        name: `${en ? "Remove" : "Eliminar"} An eleventh tag`,
        exact: true,
      }),
    ).toHaveCount(0);
    await tags.fill("");
    await name.fill(` ${"🥾".repeat(200)} `);
    await description.fill(` ${"🌲".repeat(5000)} `);
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "temporarily unavailable" : "no está disponible temporalmente",
    );
    expect(submissions).toBe(1);
    await expect(name).toHaveAttribute("aria-invalid", "false");
    await expect(description).toHaveAttribute("aria-invalid", "false");
  });
  test(`${locale} upload explains guest and unconfirmed eligibility`, async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto(`/${locale}/tracks/upload`);
    await expect(
      page.getByRole("link", {
        name: en ? "Create an account" : "Crear una cuenta",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("form", { name: en ? "Upload track" : "Subir recorrido" }),
    ).toHaveCount(0);
    await account(context, baseURL!, false);
    await page.reload();
    await expect(
      page.getByRole("link", {
        name: en ? "Account settings" : "Ajustes de la cuenta",
      }),
    ).toBeVisible();
    await expect(page.getByLabel(en ? "GPX file" : "Archivo GPX")).toHaveCount(
      0,
    );
  });
}

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} owners edit tracks in place and confirm permanent deletion`, async ({
      page,
      context,
      browser,
      baseURL,
    }) => {
      const en = locale === "en";
      const t = (en ? enMessages : esMessages).Tracks;
      if (theme === "dark")
        await page.addInitScript(() =>
          Object.defineProperty(window, "navigation", {
            configurable: true,
            value: undefined,
          }),
        );
      const ownerId = await account(context, baseURL!);
      const requestId = randomUUID();
      const response = await context.request.post(`${baseURL}/api/tracks`, {
        headers: { origin: baseURL! },
        multipart: {
          name: "Editable ridge",
          description: "Original description",
          activity: "hiking",
          difficulty: "3",
          tags: '["forest"]',
          visibility: "public",
          requestId,
          file: {
            name: "ridge.gpx",
            mimeType: "application/gpx+xml",
            buffer: gpx,
          },
        },
      });
      expect(response.status()).toBe(201);
      const { id } = await response.json();
      await pool.query("UPDATE users SET email_confirmed=false WHERE id=$1", [
        ownerId,
      ]);
      const guest = await browser.newContext();
      const guestPage = await guest.newPage();
      await stubBasemap(guestPage);
      await guestPage.goto(`${baseURL}/${locale}/tracks/${id}`);
      await expect(
        guestPage.getByRole("heading", { name: "Editable ridge" }),
      ).toBeVisible();
      await expect(
        guestPage.getByRole("button", { name: t.edit.start, exact: true }),
      ).toHaveCount(0);
      await guest.close();
      await page.goto(`/${locale}/tracks`);
      await page
        .getByRole("link", { name: "Editable ridge", exact: true })
        .click();
      await selectTheme(page, theme);
      const edit = page.getByRole("button", {
        name: t.edit.start,
        exact: true,
      });
      // Clean navigation also fires the guard during Next's history commit.
      await page.getByRole("link", { name: t.back, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/tracks/upload$`));
      await page.goBack();
      await expect(edit).toBeVisible();
      await edit.click();
      const name = page.getByRole("textbox", { name: t.name, exact: true });
      await expect(name).toBeFocused();
      await name.fill("Unsaved draft");
      page.once("dialog", (dialog) => dialog.dismiss());
      await page
        .getByRole("button", { name: t.edit.cancel, exact: true })
        .click();
      await expect(name).toHaveValue("Unsaved draft");
      page.once("dialog", (dialog) => dialog.dismiss());
      await page.getByRole("link", { name: t.back, exact: true }).click();
      await expect(name).toHaveValue("Unsaved draft");
      const backDialog = page.waitForEvent("dialog");
      await page.evaluate(() => history.back());
      await (await backDialog).dismiss();
      await expect(page).toHaveURL(new RegExp(`/tracks/${id}$`));
      await expect(name).toHaveValue("Unsaved draft");
      await Promise.all([
        page.waitForEvent("dialog").then((dialog) => dialog.dismiss()),
        page.evaluate(() => location.reload()),
      ]);
      await expect(name).toHaveValue("Unsaved draft");
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("link", { name: t.back, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/tracks/upload$`));
      await page.goBack();
      await expect(edit).toBeVisible();
      await expect(name).toHaveCount(0);
      await edit.click();
      await expect(name).toHaveValue("Editable ridge");
      await name.fill("Another unsaved draft");
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: t.edit.cancel, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Editable ridge", exact: true }),
      ).toBeVisible();
      await edit.click();
      await name.fill("");
      await page
        .getByRole("button", { name: t.edit.save, exact: true })
        .click();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await name.fill("Edited ridge");
      await page
        .getByRole("textbox", { name: t.description, exact: true })
        .fill("Updated description\n<script>plain text</script>");
      await page
        .getByRole("combobox", { name: t.activity, exact: true })
        .selectOption("walking");
      await page
        .getByRole("combobox", { name: t.difficulty, exact: true })
        .selectOption("5");
      await page
        .getByRole("combobox", { name: t.visibility, exact: true })
        .selectOption("private");
      await expect(page.getByText(t.edit.privateWarning)).toBeVisible();
      await page
        .getByRole("button", {
          name: t.remove.replace("{tag}", "forest"),
          exact: true,
        })
        .click();
      await page
        .getByRole("textbox", { name: t.tags, exact: true })
        .fill("new tag");
      await page.getByRole("button", { name: t.add, exact: true }).click();
      await page.route(`**/api/tracks/${id}`, async (route) => {
        await page.unroute(`**/api/tracks/${id}`);
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"unavailable"}',
        });
      });
      await page
        .getByRole("button", { name: t.edit.save, exact: true })
        .click();
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        t.errors.unavailable,
      );
      await expect(name).toHaveValue("Edited ridge");
      let releaseSave!: () => void;
      const saveGate = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      await page.route(`**/api/tracks/${id}`, async (route) => {
        await saveGate;
        await route.continue();
      });
      await page
        .getByRole("button", { name: t.edit.save, exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: t.edit.saving, exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: t.edit.delete, exact: true }),
      ).toBeDisabled();
      releaseSave();
      await expect(
        page.getByRole("heading", { name: "Edited ridge", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("status").filter({ hasText: t.edit.saved }),
      ).toBeVisible();
      const result = await pool.query(
        "SELECT name, activity, difficulty, visibility FROM tracks WHERE id=$1",
        [id],
      );
      expect(result.rows[0]).toEqual({
        name: "Edited ridge",
        activity: "walking",
        difficulty: 5,
        visibility: "private",
      });
      const anonymous = await browser.newContext();
      const denied = await anonymous.request.get(
        `${baseURL}/api/tracks/${id}/data`,
      );
      expect(denied.status()).toBe(404);
      await anonymous.close();
      await expect(edit).toBeEnabled();
      await expect(edit).toBeFocused();
      await page.unroute(`**/api/tracks/${id}`);
      await edit.click();
      await page
        .getByRole("combobox", { name: t.visibility, exact: true })
        .selectOption("public");
      await expect(page.getByText(t.publicWarning)).toBeVisible();
      await name.fill("Uncommitted name");
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (locale === "en" && theme === "light")
        await page.screenshot({
          path: "/tmp/track-atlas-inline-edit.png",
          fullPage: true,
        });
      await page
        .getByRole("button", { name: t.edit.delete, exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading")).toHaveText(
        t.edit.deleteTitle.replace("{name}", "Edited ridge"),
      );
      await expect(
        dialog.getByRole("button", { name: t.edit.cancel, exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(name).toHaveValue("Uncommitted name");
      await page.route(`**/api/tracks/${id}`, async (route) => {
        await page.unroute(`**/api/tracks/${id}`);
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"unavailable"}',
        });
      });
      await page
        .getByRole("button", { name: t.edit.delete, exact: true })
        .click();
      await dialog
        .getByRole("button", { name: t.edit.deletePermanently, exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toContainText(
        t.errors.unavailable,
      );
      await dialog
        .getByRole("button", { name: t.edit.cancel, exact: true })
        .click();
      await expect(name).toHaveValue("Uncommitted name");
      await page
        .getByRole("button", { name: t.edit.delete, exact: true })
        .click();
      await dialog
        .getByRole("button", { name: t.edit.deletePermanently, exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`/users/${ownerId}/tracks$`));
      expect(
        (await pool.query("SELECT id FROM tracks WHERE id=$1", [id])).rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT track_id FROM deleted_track_uploads WHERE track_id=$1",
            [id],
          )
        ).rowCount,
      ).toBe(1);
      await page.goBack();
      await expect(
        page.getByRole("button", { name: t.edit.start, exact: true }),
      ).toHaveCount(0);
    });
  }
}

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} photo picker stages captions and gallery opens with keyboard navigation`, async ({
      page,
      context,
      baseURL,
    }) => {
      const english = locale === "en";
      const owner = await account(context, baseURL!);
      await page.goto(`/${locale}/tracks/upload`);
      await selectTheme(page, theme);
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await fillTrack(page, english);
      let rejectFirst = true;
      await page.route("**/api/files?purpose=photo", async (route) => {
        if (rejectFirst) {
          rejectFirst = false;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "unavailable" }),
          });
        } else await route.continue();
      });
      const image = await sharp({
        create: { width: 40, height: 30, channels: 3, background: "red" },
      })
        .jpeg()
        .toBuffer();
      await page.locator("input[type=file][multiple]").setInputFiles([
        { name: "one.jpg", mimeType: "image/jpeg", buffer: image },
        { name: "two.jpg", mimeType: "image/jpeg", buffer: image },
      ]);
      const captions = page
        .getByRole("region", {
          name: english ? "Photos" : "Fotos",
          exact: true,
        })
        .getByLabel(english ? "Caption" : "Descripción", {
          exact: true,
        });
      await captions.first().fill("First photograph");
      await expect(
        page.getByRole("button", {
          name: english ? "Retry" : "Reintentar",
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: english ? "Retry" : "Reintentar",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("button", {
          name: english ? "Upload track" : "Subir recorrido",
          exact: true,
        }),
      ).toBeEnabled();
      // Expiry must preserve the local draft and allow retry without reselection.
      await page.clock.install();
      await page.clock.fastForward(15 * 60 * 1000);
      await expect(
        page.getByRole("button", {
          name: english ? "Retry" : "Reintentar",
          exact: true,
        }),
      ).toHaveCount(2);
      await page
        .getByRole("button", {
          name: english ? "Retry" : "Reintentar",
          exact: true,
        })
        .first()
        .click();
      await expect(
        page.getByRole("button", {
          name: english ? "Retry" : "Reintentar",
          exact: true,
        }),
      ).toHaveCount(1);
      await page
        .getByRole("button", {
          name: english ? "Retry" : "Reintentar",
          exact: true,
        })
        .click();
      await expect(captions.first()).toHaveValue("First photograph");
      await expect(
        page.getByRole("button", {
          name: english ? "Upload track" : "Subir recorrido",
          exact: true,
        }),
      ).toBeEnabled();
      const photoItems = page.locator("li[draggable=true]");
      await photoItems.first().dragTo(photoItems.nth(1));
      await expect(captions.nth(1)).toHaveValue("First photograph");
      await page
        .getByRole("button", {
          name: english ? "Earlier" : "Antes",
          exact: true,
        })
        .nth(1)
        .click();
      const dropped = await page.evaluateHandle(
        (bytes) => {
          const transfer = new DataTransfer();
          transfer.items.add(
            new File([new Uint8Array(bytes)], "drop.jpg", {
              type: "image/jpeg",
            }),
          );
          return transfer;
        },
        [...image],
      );
      // A canceled internal drag must not consume the next external file drop.
      await photoItems.first().dispatchEvent("dragstart");
      await photoItems.first().dispatchEvent("dragend");
      const droppedUpload = page.waitForResponse(
        (response) =>
          response.url().includes("/api/files?purpose=photo") &&
          response.status() === 201,
      );
      await page
        .getByRole("region", {
          name: english ? "Photos" : "Fotos",
          exact: true,
        })
        .dispatchEvent("drop", { dataTransfer: dropped });
      await droppedUpload;
      await dropped.dispose();
      await expect(captions).toHaveCount(3);
      await page
        .getByRole("button", {
          name: english ? "Remove" : "Eliminar",
          exact: true,
        })
        .nth(2)
        .click();
      await expect(captions).toHaveCount(2);
      let releaseSave!: () => void;
      const saveGate = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      await page.route("**/api/tracks", async (route) => {
        if (["POST", "PATCH"].includes(route.request().method()))
          await saveGate;
        await route.continue();
      });
      await page
        .getByRole("button", {
          name: english ? "Upload track" : "Subir recorrido",
          exact: true,
        })
        .click();
      await expect(captions.first()).toBeDisabled();
      const pendingPicker = page.getByRole("region", {
        name: english ? "Photos" : "Fotos",
        exact: true,
      });
      await expect(pendingPicker.locator("input[type=file]")).toBeDisabled();
      await expect(pendingPicker.locator("li[draggable=true]")).toHaveCount(0);
      for (const button of await pendingPicker.getByRole("button").all())
        await expect(button).toBeDisabled();
      const pendingDrop = await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        dt.items.add(
          new File(["ignored"], "ignored.jpg", { type: "image/jpeg" }),
        );
        return dt;
      });
      await pendingPicker.dispatchEvent("drop", { dataTransfer: pendingDrop });
      await pendingDrop.dispose();
      await expect(captions).toHaveCount(2);
      releaseSave();

      await expect(page).toHaveURL(
        new RegExp(`/${locale}/tracks/[a-f0-9-]+$`),
        {
          timeout: 20000,
        },
      );

      const edits = english ? enMessages.Tracks.edit : esMessages.Tracks.edit;
      await page
        .getByRole("button", { name: edits.start, exact: true })
        .click();
      const editorCaptions = page
        .getByRole("region", {
          name: english ? "Photos" : "Fotos",
          exact: true,
        })
        .getByLabel(english ? "Caption" : "Descripción", { exact: true });
      // Editing replaces the gallery in its below-map slot, rather than
      // appending controls below the entire details article.
      await expect(
        page
          .locator("article")
          .getByRole("region", {
            name: english ? "Photos" : "Fotos",
            exact: true,
          })
          .getByRole("textbox")
          .first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: english ? "Photos 1 / 2" : "Fotos 1 / 2",
        }),
      ).toHaveCount(0);
      await editorCaptions.first().fill("Discarded caption");
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: edits.cancel, exact: true })
        .click();
      await page
        .getByRole("button", { name: edits.start, exact: true })
        .click();
      await expect(editorCaptions.first()).toHaveValue("First photograph");
      // Add and remove photos through the below-map editor, then persist
      // the replacement along with its caption and ordering.
      let releasePhoto!: () => void;
      const photoGate = new Promise<void>((resolve) => {
        releasePhoto = resolve;
      });
      await page.route("**/api/files?purpose=photo", async (route) => {
        await photoGate;
        await route.continue();
      });
      const save = page.getByRole("button", { name: edits.save, exact: true });
      const photoHint = page.locator('[data-slot="tooltip-trigger"]', {
        has: save,
      });
      try {
        await page.locator("article input[type=file][multiple]").setInputFiles({
          name: "replacement.jpg",
          mimeType: "image/jpeg",
          buffer: image,
        });
        await expect(save).toBeDisabled();
        await photoHint.hover();
        await expect(page.getByRole("tooltip")).toHaveText(
          (english ? enMessages : esMessages).Tracks.photosBlockingSubmit,
        );
        await page.mouse.move(0, 0);
        await photoHint.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(photoHint).toBeFocused();
        await expect(page.getByRole("tooltip")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("tooltip")).not.toBeVisible();
      } finally {
        releasePhoto();
      }
      await expect(save).toBeEnabled();
      await expect(photoHint).toHaveAttribute("tabindex", "-1");
      await photoHint.hover();
      await expect(page.getByRole("tooltip")).not.toBeVisible();
      await expect(editorCaptions).toHaveCount(3);
      await editorCaptions.nth(2).fill("Second photograph");
      await page
        .getByRole("button", {
          name: english ? "Remove" : "Eliminar",
          exact: true,
        })
        .nth(1)
        .click();
      await expect(editorCaptions).toHaveCount(2);
      await expect(
        page.getByRole("button", {
          name: edits.save,
          exact: true,
        }),
      ).toBeEnabled();
      await page
        .getByRole("button", {
          name: english ? "Earlier" : "Antes",
          exact: true,
        })
        .nth(1)
        .click();
      await expect(editorCaptions.first()).toHaveValue("Second photograph");
      await page
        .getByRole("button", {
          name: english ? "Later" : "Después",
          exact: true,
        })
        .first()
        .click();
      let releaseEdit!: () => void;
      const editGate = new Promise<void>((resolve) => {
        releaseEdit = resolve;
      });
      await page.route("**/api/tracks/*", async (route) => {
        if (["POST", "PATCH"].includes(route.request().method()))
          await editGate;
        await route.continue();
      });
      await page.getByRole("button", { name: edits.save, exact: true }).click();
      await expect(editorCaptions.first()).toBeDisabled();
      const editingPicker = page
        .getByRole("region", {
          name: english ? "Photos" : "Fotos",
          exact: true,
        })
        .filter({ has: page.locator("input[type=file][multiple]") });
      await expect(editingPicker.locator("input[type=file]")).toBeDisabled();
      await expect(editingPicker.locator("li[draggable=true]")).toHaveCount(0);
      for (const button of await editingPicker.getByRole("button").all())
        await expect(button).toBeDisabled();
      const editingDrop = await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        dt.items.add(
          new File(["ignored"], "ignored.jpg", { type: "image/jpeg" }),
        );
        return dt;
      });
      await editingPicker.dispatchEvent("drop", { dataTransfer: editingDrop });
      await editingDrop.dispose();
      await expect(editorCaptions).toHaveCount(2);
      releaseEdit();

      await expect(page.getByText(edits.saved, { exact: true })).toBeVisible();
      // The save acknowledgment precedes the server refresh that replaces the
      // gallery. Wait for its persisted caption before opening that gallery.
      await expect(
        page.getByRole("img", { name: "Second photograph", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: english ? "Photos 1 / 2" : "Fotos 1 / 2" })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const slidePhoto = dialog.locator(
        '[aria-roledescription="slide"]:not([inert]) img',
      );
      await expect(async () => {
        const sizing = await slidePhoto.evaluate((image: HTMLImageElement) => {
          const popup = image.closest('[data-slot="dialog-content"]')!;
          const close = popup.querySelector('[data-slot="dialog-close"]')!;
          const caption = image.closest("figure")!.querySelector("figcaption")!;
          return {
            photo: image.getBoundingClientRect().toJSON(),
            close: close.getBoundingClientRect().toJSON(),
            caption: caption.getBoundingClientRect().toJSON(),
            naturalWidth: image.naturalWidth,
            fit: getComputedStyle(image).objectFit,
            scrollHeight: popup.scrollHeight,
            clientHeight: popup.clientHeight,
            viewportHeight: window.innerHeight,
            viewportWidth: document.documentElement.clientWidth,
          };
        });
        expect(sizing.naturalWidth).toBeGreaterThan(0);
        expect(sizing.fit).toBe("contain");
        expect(sizing.photo.height).toBeGreaterThan(0);
        expect(sizing.photo.top).toBeGreaterThanOrEqual(sizing.close.bottom);
        expect(sizing.photo.bottom).toBeLessThanOrEqual(sizing.caption.top);
        expect(sizing.caption.bottom).toBeLessThan(sizing.viewportHeight);
        expect(
          Math.abs(sizing.photo.width - sizing.viewportWidth),
        ).toBeLessThan(2);
        expect(sizing.scrollHeight).toBeLessThanOrEqual(sizing.clientHeight);
      }).toPass({ timeout: 5000 });
      await expect(
        dialog.getByText("First photograph", { exact: false }),
      ).toBeVisible();
      await dialog.press("ArrowRight");
      await expect(
        dialog.locator('[aria-roledescription="slide"]:not([inert])'),
      ).toContainText("Second photograph");
      await dialog.press("Escape");
      await expect(dialog).not.toBeVisible();
      const trackId = new URL(page.url()).pathname.split("/").at(-1)!;
      const list = await page.request.get(`/api/tracks/${trackId}/photos`);
      expect(list.status()).toBe(200);
      const photos = await list.json();
      expect(photos[0].caption).toBe("First photograph");
      expect(photos[1].caption).toBe("Second photograph");
      expect(
        (await page.request.get(`/api/files/${photos[0].id}`)).status(),
      ).toBe(200);
      const cookies = await context.cookies();
      await context.clearCookies();
      expect(
        (await page.request.get(`/api/files/${photos[0].id}`)).status(),
      ).toBe(401);
      expect(
        (
          await page.request.get(
            `/api/tracks/${trackId}/photos/${photos[0].id}`,
          )
        ).status(),
      ).toBe(404);
      await context.addCookies(cookies);
      const metadata = {
        name: "Public photo track",
        description: "Description",
        activity: "hiking",
        difficulty: 3,
        tags: [],
        visibility: "public",
        photos,
      };
      expect(
        (
          await page.request.patch(`/api/tracks/${trackId}`, {
            headers: { Origin: baseURL! },
            data: metadata,
          })
        ).status(),
      ).toBe(200);
      await context.clearCookies();
      expect(
        (
          await page.request.get(
            `/api/tracks/${trackId}/photos/${photos[0].id}?size=thumbnail&format=jpeg`,
          )
        ).status(),
      ).toBe(200);
      expect(
        (await page.request.get(`/api/files/${photos[0].id}`)).status(),
      ).toBe(401);
      await context.addCookies(cookies);
      await pool.query("UPDATE users SET admin=true WHERE id=$1", [owner]);
      expect(
        (
          await page.request.get(`/api/admin/photos/${photos[0].id}/original`)
        ).status(),
      ).toBe(200);
      expect(
        (
          await page.request.post("/api/admin/mutations", {
            headers: { Origin: baseURL! },
            data: {
              model: "track_photos",
              operation: "update",
              ids: [JSON.stringify([photos[0].id])],
              values: { caption: "Admin caption" },
            },
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await page.request.post("/api/admin/mutations", {
            headers: { Origin: baseURL! },
            data: {
              model: "track_photos",
              operation: "delete",
              ids: [JSON.stringify([photos[0].id])],
            },
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await page.request.get(
            `/api/tracks/${trackId}/photos/${photos[0].id}`,
          )
        ).status(),
      ).toBe(404);
    });
  }
}

test("photo picker restores interrupted uploads and previews after Activity navigation", async ({
  page,
  context,
  baseURL,
}) => {
  await account(context, baseURL!);
  await page.goto("/en/tracks/upload");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route("**/api/files?purpose=photo", async (route) => {
    started = true;
    await gate;
    await route.fulfill({ status: 503, body: "{}" }).catch(() => {});
  });
  const image = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "blue" },
  })
    .jpeg()
    .toBuffer();
  // File selection does not wait for enabled controls in Playwright. Wait for
  // hydration to enable the form before dispatching its change event.
  await expect(page.locator("input[type=file][multiple]")).toBeEnabled();
  await page.locator("input[type=file][multiple]").setInputFiles({
    name: "restore.jpg",
    mimeType: "image/jpeg",
    buffer: image,
  });
  const caption = page.getByLabel("Caption", { exact: true });
  await caption.fill("Retained draft");
  await expect.poll(() => started).toBe(true);
  const preview = page
    .getByRole("region", { name: "Photos", exact: true })
    .locator("img");
  const before = await preview.getAttribute("src");
  await page.locator('header a[href="/en"]').first().click();
  await expect(page).toHaveURL(/\/en$/);
  await page.goBack();
  await expect(caption).toHaveValue("Retained draft");
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect(preview).not.toHaveAttribute("src", before!);
  await expect
    .poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(20);
  release();
  await page.unroute("**/api/files?purpose=photo");
  const retried = page.waitForResponse(
    (response) =>
      response.url().includes("/api/files?purpose=photo") &&
      response.status() === 201,
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await retried;
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Uploading", { exact: false })).toHaveCount(0);
  await expect(caption).toHaveValue("Retained draft");
});

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} details votes refresh totals, withdraw and switch safely with eligible controls only`, async ({
      page,
      context,
      baseURL,
    }) => {
      const owner = await account(context, baseURL!);
      const id = await createAnalyticsTrack(context, baseURL!, gpx);
      await pool.query("UPDATE tracks SET visibility='public' WHERE id=$1", [
        id,
      ]);
      await context.clearCookies();
      await account(context, baseURL!);
      const labels = (locale === "en" ? enMessages : esMessages).Tracks.votes;
      await page.goto(`/${locale}/tracks/${id}`);
      await selectTheme(page, theme);
      const region = page.getByRole("region", {
        name: labels.title,
        exact: true,
      });
      const up = region.getByRole("button", { name: labels.up, exact: true });
      const down = region.getByRole("button", {
        name: labels.down,
        exact: true,
      });
      const messages = locale === "en" ? enMessages : esMessages;
      const toolbox = page.getByRole("complementary", {
        name: messages.Tracks.tools,
      });
      await expect(
        toolbox.getByRole("link", {
          name: messages.Tracks.download,
        }),
      ).toBeVisible();
      await expect(
        toolbox.getByRole("button", {
          name: messages.Lists.bookmark,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        toolbox.getByRole("button", {
          name: labels.up,
          exact: true,
        }),
      ).toBeVisible();
      const mapColumn = page.getByTestId("track-map-column");
      const desktopMap = (await mapColumn.boundingBox())!;
      const desktopTools = (await toolbox.boundingBox())!;
      expect(desktopTools.x).toBeGreaterThanOrEqual(
        desktopMap.x + desktopMap.width,
      );
      expect(desktopMap.width / desktopTools.width).toBeCloseTo(4, 1);
      await page.setViewportSize({ width: 390, height: 844 });
      const mobileMap = (await mapColumn.boundingBox())!;
      const mobileTools = (await toolbox.boundingBox())!;
      expect(mobileTools.y).toBeGreaterThanOrEqual(
        mobileMap.y + mobileMap.height,
      );
      expect(Math.abs(mobileMap.width - mobileTools.width)).toBeLessThan(1);
      await expect(toolbox).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 720 });
      const editorLink = toolbox.getByRole("link", {
        name: messages.Tracks.gpxStudio,
        exact: true,
      });
      await expect(editorLink).toHaveAttribute("target", "_blank");
      // Exercise the real redirect and GPX delivery without sending fixtures
      // to a third-party service or depending on its map/editor scripts.
      await context.route("https://gpx.studio/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><title>Editor</title>",
        }),
      );
      const popupPromise = page.waitForEvent("popup");
      await editorLink.click();
      const popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded");
      const editor = new URL(popup.url());
      expect(editor.origin).toBe("https://gpx.studio");
      expect(editor.pathname).toBe(`/${locale}/app`);
      const file = JSON.parse(editor.searchParams.get("files")!)[0];
      const exported = await context.request.get(file, {
        headers: { cookie: "", origin: "https://gpx.studio" },
      });
      expect(exported.status()).toBe(200);
      expect(exported.headers()["access-control-allow-origin"]).toBe(
        "https://gpx.studio",
      );
      expect(await exported.body()).toEqual(gpx);
      await popup.close();
      const popularity = page.getByTestId("vote-popularity");
      await expect(
        popularity.locator("xpath=../preceding-sibling::dt"),
      ).toHaveText(labels.popularity);
      await expect(up).toContainText(labels.up);
      await expect(down).toContainText(labels.down);
      await expect(up).toHaveAttribute("aria-pressed", "false");
      await up.click();
      await expect(up).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("vote-popularity")).toHaveText("1");
      const total = (name: string) =>
        region
          .locator("dl > div")
          .filter({ has: page.getByText(name, { exact: true }) })
          .getByTestId("vote-count");
      await expect(total(labels.up)).toHaveText("1");
      await expect(total(labels.down)).toHaveText("0");
      await down.click();
      await expect(down).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("vote-popularity")).toHaveText("-1");
      await expect(total(labels.up)).toHaveText("0");
      await expect(total(labels.down)).toHaveText("1");
      await page.reload();
      await expect(down).toHaveAttribute("aria-pressed", "true");
      await page.route(`**/api/tracks/${id}/vote`, (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "unavailable" }),
        }),
      );
      await up.click();
      await expect(region.getByRole("alert")).toHaveText(labels.failed);
      await expect(down).toHaveAttribute("aria-pressed", "true");
      await page.unroute(`**/api/tracks/${id}/vote`);
      await down.click();
      await expect(down).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByTestId("vote-popularity")).toHaveText("0");
      await context.clearCookies();
      await page.reload();
      await expect(region.getByRole("button")).toHaveCount(0);
      await expect(
        toolbox.getByRole("link", {
          name: messages.Tracks.gpxStudio,
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        toolbox.getByRole("button", {
          name: messages.Tracks.loginToGpxStudio,
          exact: true,
        }),
      ).toBeVisible();
      await account(context, baseURL!, false);
      await page.reload();
      await expect(region).toContainText(labels.confirm);
      await expect(region.getByRole("button")).toHaveCount(0);
      await context.clearCookies();
      // Restore a fresh owner session, including on private details.
      const token = randomBytes(32).toString("base64url");
      await acceptFixtureDocuments(pool, owner);
      await pool.query(
        "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
        [owner, createHash("sha256").update(token).digest("hex")],
      );
      await context.addCookies([
        {
          name: "track_atlas_session",
          value: token,
          url: baseURL!,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      await page.reload();
      await expect(region.getByRole("button")).toHaveCount(0);
      await pool.query("UPDATE tracks SET visibility='private' WHERE id=$1", [
        id,
      ]);
      await page.reload();
      await expect(region).toBeVisible();
      await expect(region.getByRole("button")).toHaveCount(0);
      await expect(editorLink).toBeVisible();
      await page.goto(`/${locale}/users/${owner}/tracks`);
      await expect(
        page.getByRole("region", { name: labels.title, exact: true }),
      ).toHaveCount(0);
    });
  }
}

// Widely separated segments followed by an identical shared endpoint. Later
// timestamps reset backwards; elapsed duration remains three local minutes.
const segmentedGpx =
  Buffer.from(`<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="acceptance"><trk>
<trkseg><trkpt lat="40" lon="-3"><ele>10</ele><time>2026-01-02T00:00:00Z</time></trkpt><trkpt lat="40.001" lon="-3.001"><ele>20</ele><time>2026-01-02T00:01:00Z</time></trkpt></trkseg>
<trkseg><trkpt lat="41" lon="-4"><ele>1000</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="41.001" lon="-4.001"><ele>1010</ele><time>2026-01-01T00:01:00Z</time></trkpt></trkseg>
<trkseg><trkpt lat="41.001" lon="-4.001"><ele>2000</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="41.002" lon="-4.002"><ele>2010</ele><time>2026-01-01T00:01:00Z</time></trkpt></trkseg>
</trk></gpx>`);

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} multi-segment upload retains disjoint and same-endpoint breaks`, async ({
      context,
      page,
      baseURL,
    }) => {
      const en = locale === "en";
      const messages = en ? enMessages : esMessages;
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        // A fixture owner without an avatar intentionally gets a private 404.
        if (
          message.type() === "error" &&
          !/\/api\/tracks\/[^/]+\/avatar$/.test(message.location().url)
        )
          consoleErrors.push(message.text());
      });
      await account(context, baseURL!);
      await page.goto(`/${locale}/tracks/upload`);
      await selectTheme(page, theme);
      await fillTrack(page, en, segmentedGpx);
      await page
        .getByRole("form", { name: messages.Tracks.title })
        .getByRole("button", { name: messages.Tracks.title, exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/tracks/[0-9a-f-]{36}$`),
      );
      const id = page.url().split("/").at(-1)!;
      const segments = await mapSegments(page);
      expect(segments).toEqual([
        [
          [-3, 40],
          [-3.001, 40.001],
        ],
        [
          [-4, 41],
          [-4.001, 41.001],
        ],
        [
          [-4.001, 41.001],
          [-4.002, 41.002],
        ],
      ]);
      await expect(
        page
          .locator("dt")
          .filter({ hasText: new RegExp(`^${messages.Tracks.segments}$`) })
          .locator("+ dd"),
      ).toHaveText("3");
      const data = await (
        await context.request.get(`/api/tracks/${id}/data`)
      ).json();
      expect(data.segmentStarts).toEqual([0, 2, 4]);
      expect(
        data.samples.map(
          (sample: { speedMps: number | null }) => sample.speedMps === null,
        ),
      ).toEqual([true, false, true, false, true, false]);
      expect(data.samples[2].distanceMeters).toBe(
        data.samples[1].distanceMeters,
      );
      expect(data.samples[4].distanceMeters).toBe(
        data.samples[3].distanceMeters,
      );
      expect(data.samples[5].distanceMeters).toBeLessThan(500);
      // No elevation jump at either boundary contributes to the displayed ascent.
      const stats = page.getByLabel(
        en ? "Main statistics" : "Estadísticas principales",
        { exact: true },
      );
      await expect(stats).toContainText("30 m");
      await expect(
        page
          .locator("dt")
          .filter({
            hasText: new RegExp(`^${messages.Tracks.analytics.duration}$`),
          })
          .locator("+ dd"),
      ).toContainText("3 min");
      const map = page.getByRole("region", {
        name: messages.Tracks.map.title,
        exact: true,
      });
      await expect(map.locator(".maplibregl-marker")).toHaveCount(5);
      const endpoint = map.getByLabel(
        en
          ? "Segment 2: End; Segment 3: Start"
          : "Segmento 2: Final; Segmento 3: Inicio",
        { exact: true },
      );
      await endpoint.focus();
      await endpoint.press("Enter");
      await expect(endpoint.locator("..")).toHaveAttribute("open", "");
      await expect(
        endpoint
          .locator("..")
          .getByText(en ? "Segment 3: Start" : "Segmento 3: Inicio", {
            exact: true,
          }),
      ).toBeVisible();
      await endpoint.press("Escape");
      await expect(endpoint).toBeFocused();
      const curves = page.locator(".recharts-line-curve");
      await expect(curves).toHaveCount(2);
      for (const curve of await curves.all())
        expect((await curve.getAttribute("d"))?.match(/M/g)).toHaveLength(3);
      await expect(page.locator(".recharts-reference-line")).toHaveCount(4);
      const download = page.getByRole("link", {
        name: en ? "Download GPX" : "Descargar GPX",
        exact: true,
      });
      const original = await context.request.get(
        (await download.getAttribute("href"))!,
      );
      expect(original.status()).toBe(200);
      expect(await original.body()).toEqual(segmentedGpx);
      await page.reload();
      expect(await mapSegments(page)).toEqual(segments);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(consoleErrors).toEqual([]);
    });
  }
}

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} multi-segment upload rejects the whole file and identifies invalid segments`, async ({
      context,
      page,
      baseURL,
    }) => {
      const en = locale === "en";
      const messages = en ? enMessages.Tracks : esMessages.Tracks;
      await account(context, baseURL!);
      await page.goto(`/${locale}/tracks/upload`);
      await selectTheme(page, theme);
      const valid =
        '<trkseg><trkpt lat="40" lon="-3"/><trkpt lat="40.001" lon="-3.001"/></trkseg>';
      const wrap = (segments: string) =>
        Buffer.from(
          `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk>${segments}</trk></gpx>`,
        );
      await fillTrack(page, en, wrap(valid));
      const form = page.getByRole("form", { name: messages.title });
      for (const offending of [
        "<trkseg/>",
        '<trkseg><trkpt lat="41" lon="-4"/></trkseg>',
        '<trkseg><trkpt lat="41" lon="-4"/><trkpt lat="41" lon="-4"/></trkseg>',
        valid.repeat(100),
      ]) {
        await form
          .getByLabel(en ? "GPX file" : "Archivo GPX", { exact: true })
          .setInputFiles({
            name: "invalid.gpx",
            mimeType: "application/gpx+xml",
            buffer: wrap(valid + offending),
          });
        const tooMany = offending === valid.repeat(100);
        const zeroLength = offending.includes('lon="-4"/><trkpt lat="41"');
        if (zeroLength) {
          // Structural preview is guidance: only server derivation detects zero length.
          const response = page.waitForResponse(
            (r) =>
              r.url().endsWith("/api/tracks") &&
              r.request().method() === "POST",
          );
          await form
            .getByRole("button", { name: messages.title, exact: true })
            .click();
          const result = await response;
          expect(result.status()).toBe(422);
          expect(await result.json()).toEqual({
            error: "invalidSegment",
            segment: 2,
            track: 1,
          });
        } else {
          await expect(
            form.getByRole("button", { name: messages.title, exact: true }),
          ).toBeDisabled();
        }
        await expect(form.getByRole("alert")).toHaveText(
          tooMany
            ? "Track 1: " + messages.errors.tooManySegments
            : "Track 1: " +
                messages.errors.invalidSegmentNumber.replace("{segment}", "2"),
        );
        await expect(page).toHaveURL(new RegExp(`/${locale}/tracks/upload$`));
      }
      const emptyCollection = await context.request.get(
        "/api/tracks/explore?visibility=all&ownerId=" + [...owners][0],
      );
      expect((await emptyCollection.json()).total).toBe(0);
    });
  }
}

test("multi-track preview refreshes file and title before enabling submission", async ({
  context,
  page,
  baseURL,
}) => {
  await account(context, baseURL!);
  await page.goto("/en/tracks/upload");
  await expect(
    page.getByRole("button", { name: "Upload track", exact: true }),
  ).toBeDisabled();
  const multi = Buffer.from(
    gpx
      .toString()
      .replace("</gpx>", gpx.toString().match(/<trk>.*<\/trk>/)![0] + "</gpx>"),
  );
  await fillTrack(page, true, multi);
  const preview = page.getByRole("region", { name: "Upload preview" });
  await expect(preview).toContainText("2 Tracks will be created");
  await expect(preview.getByRole("listitem")).toHaveText([
    "Private ridge 1",
    "Private ridge 2",
  ]);
  await expect(preview).toContainText("Photos attach only to the first Track");
  await page.getByLabel("Name", { exact: true }).fill("New title");
  await expect(preview.getByRole("listitem")).toHaveText([
    "New title 1",
    "New title 2",
  ]);
  await page.getByLabel("GPX file", { exact: true }).setInputFiles({
    name: "single.gpx",
    mimeType: "application/gpx+xml",
    buffer: gpx,
  });
  await expect(preview.getByRole("listitem")).toHaveText(["New title"]);
  await expect(
    page.getByRole("button", { name: "Upload track", exact: true }),
  ).toBeEnabled();
});

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} multi-track lost response retries all outputs and first-only ordered photos`, async ({
      context,
      page,
      baseURL,
    }) => {
      const en = locale === "en";
      const ownerId = await account(context, baseURL!);
      await page.goto(`/${locale}/tracks/upload`);
      await selectTheme(page, theme);
      const multi = Buffer.from(
        gpx
          .toString()
          .replace(
            "</gpx>",
            gpx.toString().match(/<trk>.*<\/trk>/)![0] + "</gpx>",
          ),
      );
      await fillTrack(page, en, multi);
      const preview = page.getByRole("region", {
        name: en ? "Upload preview" : "Vista previa de la subida",
      });
      await expect(preview.getByRole("listitem")).toHaveText([
        "Private ridge 1",
        "Private ridge 2",
      ]);
      const photo = await sharp({
        create: { width: 8, height: 8, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      const photoRegion = page.getByRole("region", {
        name: en ? "Photos" : "Fotos",
        exact: true,
      });
      await photoRegion.locator('input[type="file"]').setInputFiles([
        { name: "one.png", mimeType: "image/png", buffer: photo },
        { name: "two.png", mimeType: "image/png", buffer: photo },
      ]);
      const captions = photoRegion.getByRole("textbox");
      await captions.nth(0).fill("First");
      await captions.nth(1).fill("Second");
      await photoRegion
        .getByRole("button", { name: en ? "Earlier" : "Antes", exact: true })
        .nth(1)
        .click();
      let requestId = "";
      let ids: string[] = [];
      let tries = 0;
      await page.route("**/api/tracks", async (route) => {
        const body = route.request().postDataBuffer()!.toString();
        const identity = body.match(/name="requestId"\r\n\r\n([^\r]+)/)![1];
        if (!requestId) requestId = identity;
        else expect(identity).toBe(requestId);
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        const result = await response.json();
        if (!ids.length) ids = result.ids;
        else expect(result.ids).toEqual(ids);
        if (tries++ === 0) await route.abort("failed");
        else await route.fulfill({ response });
      });
      const submit = page.getByRole("button", {
        name: en ? "Upload track" : "Subir recorrido",
        exact: true,
      });
      await submit.click();
      await expect(
        page.locator("form:visible").getByRole("alert"),
      ).toContainText(en ? "Your form is retained" : "Conservamos");
      await expect(captions.nth(0)).toHaveValue("Second");
      await expect(captions.nth(1)).toHaveValue("First");
      await expect(
        page.getByLabel(en ? "Name" : "Nombre", { exact: true }),
      ).toHaveValue("Private ridge");
      // Even when local staged-photo leases expire after a lost acknowledgement,
      // resolve the original submission before selecting/uploading replacement photos.
      await page.clock.setFixedTime(Date.now() + 15 * 60 * 1000);
      await expect(photoRegion.getByRole("status")).toHaveText([
        /expired|caducado/,
        /expired|caducado/,
      ]);
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(page).toHaveURL(
        new RegExp(
          `/${locale}/users/${ownerId}/tracks\\?created=${requestId}$`,
        ),
      );
      await expectCreatedToast(page, en, 2);
      await expect(
        page
          .getByRole("list", {
            name: en ? "Track results" : "Resultados de tracks",
          })
          .getByRole("listitem"),
      ).toHaveCount(2);
      await expect(
        page.getByText((en ? enMessages : esMessages).Explore.invalidFilters, {
          exact: true,
        }),
      ).toHaveCount(0);
      for (let index = 0; index < 2; index++) {
        const response = await page.request.get(
          `/api/tracks/${ids[index]}/photos`,
        );
        expect(
          (await response.json()).map((p: { caption: string }) => p.caption),
        ).toEqual(index === 0 ? ["Second", "First"] : []);
      }
      const guest = await context.browser()!.newContext();
      try {
        const response = await guest.request.get(
          `${baseURL}/${locale}/users/${ownerId}/tracks?created=${requestId}&ids=${ids.join(",")}&count=100`,
        );
        const html = await response.text();
        expect(html).not.toContain("Private ridge");
        expect(html).not.toContain(
          en ? "2 Tracks created" : "2 tracks creados",
        );
      } finally {
        await guest.close();
      }
      await page.reload();
      await expectCreatedToast(page, en, 2);
    });
  }
}

for (const locale of ["en", "es"] as const) {
  test(`${locale} multi-track errors are localized indexed and retain the retry identity`, async ({
    context,
    page,
    baseURL,
  }) => {
    const en = locale === "en";
    const messages = en ? enMessages.Tracks : esMessages.Tracks;
    await account(context, baseURL!);
    await page.goto(`/${locale}/tracks/upload`);
    await fillTrack(page, en);
    const form = page.getByRole("form", { name: messages.title });
    let failure: object = { error: "tooManyTracks" };
    const identities: string[] = [];
    await page.route("**/api/tracks", async (route) => {
      identities.push(
        route
          .request()
          .postDataBuffer()!
          .toString()
          .match(/name="requestId"\r\n\r\n([^\r]+)/)![1],
      );
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify(failure),
      });
    });
    const submit = form.getByRole("button", {
      name: messages.title,
      exact: true,
    });
    await submit.click();
    await expect(form.getByRole("alert")).toContainText(
      en ? "100 tracks" : "100 tracks",
    );
    failure = { error: "invalidSegment", track: 2, segment: 3 };
    await submit.click();
    await expect(form.getByRole("alert")).toHaveText(
      en
        ? "Track 2: Segment 3 must contain at least two points and have positive length. Check the GPX file and try again."
        : "Track 2: El segmento 3 debe contener al menos dos puntos y tener longitud positiva. Revisa el archivo GPX e inténtalo de nuevo.",
    );
    failure = {
      error: "invalidFile",
      track: "<script>source</script>",
      segment: 999,
    };
    await submit.click();
    await expect(form.getByRole("alert")).toHaveText(
      messages.errors.invalidFile,
    );
    failure = { error: "notFound" };
    await submit.click();
    await expect(form.getByRole("alert")).toContainText(
      en ? "deleted" : "eliminado",
    );
    expect(new Set(identities).size).toBe(1);
    await expect(
      form.getByLabel(en ? "GPX file" : "Archivo GPX", { exact: true }),
    ).not.toHaveValue("");
    await expect(
      form.getByLabel(en ? "Name" : "Nombre", { exact: true }),
    ).toHaveValue("Private ridge");
  });
}

test("capped preview stays responsive and superseded worker results cannot restore old titles or files", async ({
  context,
  page,
  baseURL,
}) => {
  await account(context, baseURL!);
  await page.goto("/en/tracks/upload");
  const track = `<trk><trkseg>${Array.from({ length: 1000 }, (_, i) => `<trkpt lat="40" lon="${i / 100000}"/>`).join("")}</trkseg></trk>`;
  const document = `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><metadata><desc>FILL</desc></metadata>${track.repeat(100)}</gpx>`;
  const capped = Buffer.from(
    document.replace(
      "FILL",
      "x".repeat(10 * 1024 * 1024 - Buffer.byteLength(document) + 4),
    ),
  );
  expect(capped.byteLength).toBe(10 * 1024 * 1024);
  await fillTrack(page, true, capped);
  const preview = page.getByRole("region", { name: "Upload preview" });
  await expect(preview.getByRole("listitem")).toHaveCount(100);
  await page.getByLabel("Name", { exact: true }).fill("🥾".repeat(200));
  await expect(preview.getByRole("listitem").first()).toHaveText(
    "🥾".repeat(198) + " 1",
  );
  await expect(preview.getByRole("listitem").last()).toHaveText(
    "🥾".repeat(196) + " 100",
  );
  const started = Date.now();
  await page.getByLabel("Name", { exact: true }).fill("Superseded title");
  await page.getByLabel("Name", { exact: true }).fill("Current title");
  expect(Date.now() - started).toBeLessThan(2000);
  await page.getByLabel("GPX file", { exact: true }).setInputFiles({
    name: "current.gpx",
    mimeType: "application/gpx+xml",
    buffer: gpx,
  });
  await expect(preview.getByRole("listitem")).toHaveText(["Current title"]);
  await expect(
    page.getByRole("button", { name: "Upload track", exact: true }),
  ).toBeEnabled();
  const excessive = Buffer.from(
    `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${track.repeat(101)}</gpx>`,
  );
  await page.getByLabel("GPX file", { exact: true }).setInputFiles({
    name: "excessive.gpx",
    mimeType: "application/gpx+xml",
    buffer: excessive,
  });
  await expect(preview.getByRole("alert")).toContainText("100 tracks");
  await expect(preview.getByRole("listitem")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Upload track", exact: true }),
  ).toBeDisabled();
});

for (const locale of ["en", "es"] as const) {
  test(`${locale} photo staging admits two concurrent uploads while retaining the third in its queue`, async ({
    context,
    page,
    baseURL,
  }) => {
    const t = locale === "en" ? enMessages.Tracks : esMessages.Tracks;
    await account(context, baseURL!);
    await page.goto(`/${locale}/tracks/upload`);
    await fillTrack(page, locale === "en");
    const tagInput = page.getByRole("textbox", { name: t.tags, exact: true });
    const addTag = page.getByRole("button", { name: t.add, exact: true });
    expect((await tagInput.boundingBox())?.height).toBe(
      (await addTag.boundingBox())?.height,
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0,
      maximum = 0,
      started = 0;
    await page.route("**/api/files?purpose=photo", async (route) => {
      started++;
      active++;
      maximum = Math.max(maximum, active);
      await gate;
      try {
        await route.fulfill({ response: await route.fetch() });
      } finally {
        active--;
      }
    });
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const photos = page.getByRole("region", {
      name: locale === "en" ? "Photos" : "Fotos",
      exact: true,
    });
    try {
      await photos.locator('input[type="file"]').setInputFiles(
        [1, 2, 3].map((number) => ({
          name: `${number}.png`,
          mimeType: "image/png",
          buffer: image,
        })),
      );
      await expect.poll(() => started).toBe(2);
      await expect(
        photos.getByRole("status").filter({
          hasText: (locale === "en" ? enMessages : esMessages).Photos.queued,
        }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: t.submit, exact: true }),
      ).toBeDisabled();
      const tooltipTrigger = page.locator('[data-slot="tooltip-trigger"]', {
        has: page.getByRole("button", { name: t.submit, exact: true }),
      });
      await tooltipTrigger.hover();
      await expect(page.getByRole("tooltip")).toHaveText(
        t.photosBlockingSubmit,
      );
      await page.mouse.move(0, 0);
      await tooltipTrigger.focus();
      await expect(page.getByRole("tooltip")).toBeVisible();
    } finally {
      release();
    }
    await expect(
      page.getByRole("button", { name: t.submit, exact: true }),
    ).toBeEnabled();
    expect(started).toBe(3);
    expect(maximum).toBe(2);
  });
}

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} multi-track siblings keep independent edits privacy downloads and deletion`, async ({
      context,
      page,
      baseURL,
      browser,
    }) => {
      const en = locale === "en";
      const t = en ? enMessages.Tracks : esMessages.Tracks;
      const ownerId = await account(context, baseURL!);
      const bytes = await readFile("tests/fixtures/gpx/multi-track-1.1.gpx");
      await page.goto(`/${locale}/tracks/upload`);
      await selectTheme(page, theme);
      await fillTrack(page, en, bytes);
      await page
        .getByRole("radio", { name: en ? "Public" : "Público", exact: true })
        .check();
      await page
        .getByRole("button", {
          name: en ? "Upload track" : "Subir recorrido",
          exact: true,
        })
        .click();
      await expectCreatedToast(page, en, 2);
      const ids = await outputIds(ownerId);
      const original = await context.request.get(
        `/api/tracks/${ids[0]}/download`,
      );
      expect(original.status()).toBe(200);
      const isolated = await original.body();
      expect(isolated.toString()).toContain("Ridge &amp; river");
      expect(isolated.toString()).not.toContain("Sibling-only");
      expect(isolated.toString()).not.toContain("global-private");
      await page.goto(`/${locale}/tracks/${ids[1]}`);
      await expect(
        page.getByRole("heading", { name: "Private ridge 2", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: t.edit.start, exact: true })
        .click();
      await page
        .getByRole("textbox", { name: t.name, exact: true })
        .fill("Independent valley");
      await page
        .getByRole("combobox", { name: t.visibility, exact: true })
        .selectOption("private");
      await page
        .getByRole("button", { name: t.edit.save, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Independent valley", exact: true }),
      ).toBeVisible();
      const viewer = await browser.newContext();
      try {
        await account(viewer, baseURL!);
        expect(
          (
            await viewer.request.get(`${baseURL}/api/tracks/${ids[1]}/download`)
          ).status(),
        ).toBe(404);
        const survivorDownload = await viewer.request.get(
          `${baseURL}/api/tracks/${ids[0]}/download`,
        );
        expect(survivorDownload.status()).toBe(200);
        expect(await survivorDownload.body()).toEqual(isolated);
        await page
          .getByRole("button", { name: t.edit.start, exact: true })
          .click();
        await page
          .getByRole("button", { name: t.edit.delete, exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: t.edit.deletePermanently, exact: true })
          .click();
        await expect(page).toHaveURL(new RegExp(`/users/${ownerId}/tracks$`));
        expect(
          (await context.request.get(`/api/tracks/${ids[1]}/data`)).status(),
        ).toBe(404);
        const remaining = await viewer.request.get(
          `${baseURL}/api/tracks/${ids[0]}/download`,
        );
        expect(remaining.status()).toBe(200);
        expect(await remaining.body()).toEqual(isolated);
        await page.goto(`/${locale}/tracks/${ids[0]}`);
        await expect(
          page.getByRole("heading", { name: "Private ridge 1", exact: true }),
        ).toBeVisible();
        // Real WebGL rendering still contains only this Track's two recorded parts.
        await expect
          .poll(() => mapSegments(page))
          .toEqual([
            [
              [-3, 40],
              [-3, 40],
              [-3.001, 40.001],
            ],
            [
              [-3.001, 40.001],
              [-3.002, 40.002],
            ],
          ]);
      } finally {
        await viewer.close();
      }
    });
  }
}

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} multi-track later server rejection retains the draft and staged photo for correction`, async ({
      context,
      page,
      baseURL,
    }) => {
      const en = locale === "en";
      const ownerId = await account(context, baseURL!);
      const bytes = await readFile("tests/fixtures/gpx/multi-track-1.1.gpx");
      // Structurally valid preview, but only the server derives positive length.
      const invalid = Buffer.from(
        bytes.toString().replace('lat="2" lon="2.01"', 'lat="2" lon="2"'),
      );
      await page.goto(`/${locale}/tracks/upload`);
      await selectTheme(page, theme);
      await fillTrack(page, en, invalid);
      const photos = page.getByRole("region", {
        name: en ? "Photos" : "Fotos",
        exact: true,
      });
      const photo = await sharp({
        create: { width: 8, height: 8, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      await photos.locator('input[type="file"]').setInputFiles({
        name: "retained.png",
        mimeType: "image/png",
        buffer: photo,
      });
      await photos.getByRole("textbox").fill("Retained caption");
      const submit = page.getByRole("button", {
        name: en ? "Upload track" : "Subir recorrido",
        exact: true,
      });
      const rejection = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/tracks") && r.request().method() === "POST",
      );
      await expect(submit).toBeEnabled();
      await submit.click();
      const rejected = await rejection;
      expect(rejected.status()).toBe(422);
      expect(await rejected.json()).toEqual({
        error: "invalidSegment",
        track: 2,
        segment: 2,
      });
      await expect(
        page.locator("form:visible").getByRole("alert"),
      ).toContainText(en ? "Track 2: Segment 2" : "Track 2: El segmento 2");
      await expect(
        page.getByLabel(en ? "Name" : "Nombre", { exact: true }),
      ).toHaveValue("Private ridge");
      expect(
        await page
          .getByLabel(en ? "GPX file" : "Archivo GPX", { exact: true })
          .evaluate((input: HTMLInputElement) => input.files?.[0].name),
      ).toBe("ridge.gpx");
      await expect(photos.getByRole("textbox")).toHaveValue("Retained caption");
      expect(
        (
          await (
            await context.request.get(`/api/tracks/explore?ownerId=${ownerId}`)
          ).json()
        ).total,
      ).toBe(0);
      await page
        .getByLabel(en ? "GPX file" : "Archivo GPX", { exact: true })
        .setInputFiles({
          name: "corrected.gpx",
          mimeType: "application/gpx+xml",
          buffer: bytes,
        });
      await expect(submit).toBeEnabled();
      await submit.click();
      await expectCreatedToast(page, en, 2);
      const ids = await outputIds(ownerId);
      for (const [index, id] of ids.entries()) {
        const response = await context.request.get(`/api/tracks/${id}/photos`);
        expect(
          (await response.json()).map((p: { caption: string }) => p.caption),
        ).toEqual(index === 0 ? ["Retained caption"] : []);
      }
    });
  }
}

test("multi-track collection toast counts all outputs and preserves filters and pagination", async ({
  context,
  page,
  baseURL,
}) => {
  await account(context, baseURL!);
  await createAnalyticsTrack(context, baseURL!, gpx);
  await page.goto("/es/tracks/upload");
  await selectTheme(page, "dark");
  const track = gpx.toString().match(/<trk>[\s\S]*<\/trk>/)![0];
  const bytes = Buffer.from(
    `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">${track.repeat(12)}</gpx>`,
  );
  await fillTrack(page, false, bytes);
  await page.getByLabel("Nombre", { exact: true }).fill("😀".repeat(200));
  const titles = Array.from(
    { length: 12 },
    (_, index) => "😀".repeat(index < 9 ? 198 : 197) + ` ${index + 1}`,
  );
  await expect(
    page
      .getByRole("region", { name: "Vista previa de la subida" })
      .getByRole("listitem"),
  ).toHaveText(titles);
  await page
    .getByRole("button", { name: "Subir recorrido", exact: true })
    .click();
  await expectCreatedToast(page, false, 12);
  await expect(
    page.getByText("12 tracks encontrados", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(esMessages.Explore.invalidFilters, { exact: true }),
  ).toHaveCount(0);
  const results = page.getByRole("list", { name: "Resultados de tracks" });
  await expect(results.getByRole("listitem")).toHaveCount(10);
  await page.getByRole("link", { name: "Página 2", exact: true }).click();
  await expect(results.getByRole("listitem")).toHaveCount(2);
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/created=/);
  await page.reload();
  await expect(results.getByRole("listitem")).toHaveCount(2);
  await page
    .getByRole("searchbox", { name: /Buscar/ })
    .fill("no matching title");
  await expect(
    page.getByText("Ningún track coincide", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/created=/);
  await page
    .getByRole("link", { name: "Ver todos los tracks", exact: true })
    .click();
  await expect(
    page.getByText("13 tracks encontrados", { exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/created=/);
});

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} toolbox native sharing uses saved public Track and clean URL`, async ({
      page,
      context,
      baseURL,
    }) => {
      const en = locale === "en";
      await account(context, baseURL!);
      const id = await createAnalyticsTrack(context, baseURL!, gpx);
      await context.request.patch(`/api/tracks/${id}`, {
        headers: { origin: baseURL! },
        data: {
          name: "Saved ridge",
          description: "A public ridge",
          activity: "hiking",
          difficulty: 3,
          tags: [],
          visibility: "public",
        },
      });
      await page.addInitScript(() => {
        const calls: ShareData[] = [];
        Object.assign(window, { shareCalls: calls, clipboardCalls: [] });
        Object.defineProperty(navigator, "canShare", {
          configurable: true,
          value: () => true,
        });
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: (data: ShareData) => {
            if (!navigator.userActivation.isActive)
              throw Error("Lost activation");
            calls.push(data);
            return new Promise<void>((resolve) =>
              Object.assign(window, { finishShare: resolve }),
            );
          },
        });
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: (text: string) => {
              (
                window as unknown as { clipboardCalls: string[] }
              ).clipboardCalls.push(text);
              return Promise.resolve();
            },
          },
        });
      });
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}/tracks/${id}?source=toolbox#main-content`);
      await selectTheme(page, theme);
      const share = page.getByRole("button", {
        name: en ? "Share" : "Compartir",
        exact: true,
      });
      await expect(share).toBeVisible();
      expect((await share.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await share.focus();
      await share.press("Enter");
      await expect(share).toBeDisabled();
      await share.dispatchEvent("click");
      expect(
        await page.evaluate(
          () => (window as unknown as { shareCalls: ShareData[] }).shareCalls,
        ),
      ).toEqual([
        { title: "Saved ridge", url: `${baseURL}/${locale}/tracks/${id}` },
      ]);
      await page.evaluate(() =>
        (window as unknown as { finishShare: () => void }).finishShare(),
      );
      await expect(share).toBeEnabled();
      await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { clipboardCalls: string[] }).clipboardCalls,
        ),
      ).toEqual([]);
      await context.clearCookies();
      await page.reload();
      await expect(share).toBeVisible();
      await share.click();
      await expect(share).toBeDisabled();
      await page.evaluate(() =>
        (window as unknown as { finishShare: () => void }).finishShare(),
      );
      await expect(share).toBeEnabled();
    });
  }
}

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} toolbox clipboard feedback and accessible manual copy`, async ({
      page,
      context,
      baseURL,
    }) => {
      const en = locale === "en";
      await account(context, baseURL!);
      const id = await createAnalyticsTrack(context, baseURL!, gpx);
      const publication = await context.request.patch(`/api/tracks/${id}`, {
        headers: { origin: baseURL! },
        data: {
          name: "Saved ridge",
          description: "A public ridge",
          activity: "hiking",
          difficulty: 3,
          tags: [],
          visibility: "public",
        },
      });
      expect(publication.ok()).toBe(true);
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "canShare", {
          configurable: true,
          value: () => false,
        });
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: () => {
            throw Error("Unsupported payload must use clipboard");
          },
        });
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: (text: string) => {
              Object.assign(window, { copiedURL: text });
              return new Promise<void>((resolve) =>
                Object.assign(window, { finishCopy: resolve }),
              );
            },
          },
        });
      });
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}/tracks/${id}?ref=copy#main-content`);
      await selectTheme(page, theme);
      const share = page.getByRole("button", {
        name: en ? "Share" : "Compartir",
        exact: true,
      });
      const toasts = page.locator('[data-slot="toast"]');
      await share.click();
      await expect(share).toBeDisabled();
      await expect(toasts).toHaveCount(0);
      expect(
        await page.evaluate(
          () => (window as unknown as { copiedURL: string }).copiedURL,
        ),
      ).toBe(`${baseURL}/${locale}/tracks/${id}`);
      await page.evaluate(() =>
        (window as unknown as { finishCopy: () => void }).finishCopy(),
      );
      await expect(toasts).toContainText(en ? "Link copied" : "Enlace copiado");
      await expect(share).toBeEnabled();
      await toasts.hover();
      await toasts
        .getByRole("button", {
          name: en ? "Close notification" : "Cerrar notificación",
        })
        .click();
      for (const missing of [false, true]) {
        await page.evaluate((missing) => {
          Object.defineProperty(navigator, "share", {
            configurable: true,
            value: undefined,
          });
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: missing
              ? undefined
              : { writeText: () => Promise.reject(Error("Denied")) },
          });
        }, missing);
        await share.focus();
        await share.press("Enter");
        const dialog = page.getByRole("dialog", {
          name: en ? "Copy Track link" : "Copiar enlace del track",
        });
        await expect(dialog).toBeVisible();
        const url = dialog.getByRole("textbox", {
          name: en ? "Track link" : "Enlace del track",
        });
        await expect(url).toHaveValue(`${baseURL}/${locale}/tracks/${id}`);
        await expect(url).toHaveAttribute("readonly", "");
        await expect(url).toBeFocused();
        expect(
          await url.evaluate((el: HTMLInputElement) =>
            el.value.substring(el.selectionStart!, el.selectionEnd!),
          ),
        ).toBe(`${baseURL}/${locale}/tracks/${id}`);
        await expect(dialog).toContainText(
          en ? "Select and copy" : "Selecciona y copia",
        );
        await page.keyboard.press("Tab");
        await expect(
          dialog.getByRole("button", {
            name: en ? "Close" : "Cerrar",
            exact: true,
          }),
        ).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(share).toBeFocused();
      }
    });
  }
}

for (const locale of ["en", "es"] as const) {
  test(`${locale} toolbox native cancellation and failures never copy`, async ({
    page,
    context,
    baseURL,
  }) => {
    await account(context, baseURL!);
    const id = await createAnalyticsTrack(context, baseURL!, gpx);
    const response = await context.request.patch(`/api/tracks/${id}`, {
      headers: { origin: baseURL! },
      data: {
        name: "Saved ridge",
        description: "A public ridge",
        activity: "hiking",
        difficulty: 3,
        tags: [],
        visibility: "public",
      },
    });
    expect(response.ok()).toBe(true);
    await page.addInitScript(() => {
      // Browsers implementing share without canShare still support text/URL sharing.
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: () =>
          Promise.reject(new DOMException("Cancelled", "AbortError")),
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () => {
            throw Error("Native failures must never copy");
          },
        },
      });
    });
    await page.goto(`/${locale}/tracks/${id}`);
    const share = page.getByRole("button", {
      name: locale === "en" ? "Share" : "Compartir",
      exact: true,
    });
    await share.click();
    await expect(share).toBeEnabled();
    await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
    await expect(
      page.getByRole("dialog", {
        name: locale === "en" ? "Copy Track link" : "Copiar enlace del track",
      }),
    ).toHaveCount(0);
    for (const synchronous of [false, true]) {
      await page.evaluate((synchronous) => {
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: () => {
            if (synchronous) throw Error("Platform failure");
            return Promise.reject(
              new DOMException("Denied", "NotAllowedError"),
            );
          },
        });
      }, synchronous);
      await share.click();
      const toast = page.locator('[data-slot="toast"]');
      await expect(toast).toContainText(
        locale === "en"
          ? "Could not share this Track"
          : "No se pudo compartir este track",
      );
      await expect(
        page.getByRole("dialog", {
          name: locale === "en" ? "Copy Track link" : "Copiar enlace del track",
        }),
      ).toHaveCount(0);
      await toast.hover();
      await toast.getByRole("button").click();
      await expect(toast).toHaveCount(0);
    }
  });

  test(`${locale} toolbox follows saved visibility and title while ignoring editor drafts`, async ({
    page,
    context,
    baseURL,
  }) => {
    const en = locale === "en";
    await account(context, baseURL!);
    const id = await createAnalyticsTrack(context, baseURL!, gpx);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: (data: ShareData) => {
          Object.assign(window, { lastShare: data });
          return Promise.resolve();
        },
      });
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: () => true,
      });
    });
    await page.goto(`/${locale}/tracks/${id}`);
    const share = page.getByRole("button", {
      name: en ? "Share" : "Compartir",
      exact: true,
    });
    const edit = page.getByRole("button", {
      name: en ? "Edit track" : "Editar recorrido",
      exact: true,
    });
    await expect(share).toHaveCount(0);
    await edit.click();
    const visibility = page.getByLabel(en ? "Visibility" : "Visibilidad", {
      exact: true,
    });
    await visibility.selectOption("public");
    await expect(share).toHaveCount(0);
    await page
      .getByRole("button", {
        name: en ? "Save changes" : "Guardar cambios",
        exact: true,
      })
      .click();
    await expect(share).toBeVisible();
    await edit.click();
    await page
      .getByLabel(en ? "Name" : "Nombre", { exact: true })
      .fill("Unsaved ridge");
    await visibility.selectOption("private");
    await share.click();
    expect(
      await page.evaluate(
        () => (window as unknown as { lastShare: ShareData }).lastShare,
      ),
    ).toEqual({
      title: "Analytics fixture",
      url: `${baseURL}/${locale}/tracks/${id}`,
    });
    await visibility.selectOption("public");
    await page
      .getByRole("button", {
        name: en ? "Save changes" : "Guardar cambios",
        exact: true,
      })
      .click();
    await expect(edit).toBeVisible();
    await share.click();
    expect(
      await page.evaluate(
        () => (window as unknown as { lastShare: ShareData }).lastShare,
      ),
    ).toEqual({
      title: "Unsaved ridge",
      url: `${baseURL}/${locale}/tracks/${id}`,
    });
    await edit.click();
    await visibility.selectOption("private");
    await page
      .getByRole("button", {
        name: en ? "Save changes" : "Guardar cambios",
        exact: true,
      })
      .click();
    await expect(share).toHaveCount(0);
    await edit.click();
    await visibility.selectOption("public");
    await page
      .getByRole("button", { name: en ? "Cancel" : "Cancelar", exact: true })
      .click();
    await expect(share).toHaveCount(0);
  });
}

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} retained waypoints group safely with endpoints and preserve path fit`, async ({
      context,
      page,
      baseURL,
    }) => {
      const en = locale === "en";
      await account(context, baseURL!);
      const bytes = Buffer.from(
        gpx
          .toString()
          .replace(
            "<trk>",
            '<wpt lat="40" lon="-3"><name>Spring</name><desc>&lt;img src="https://example.test/unsafe"&gt;\nFresh water</desc></wpt><wpt lat="40" lon="-3"><name> </name><desc>Second point</desc></wpt><wpt lat="0" lon="80"><name>Off path</name></wpt><wpt lat="bad" lon="0"/><trk>',
          ),
      );
      const id = await createAnalyticsTrack(context, baseURL!, bytes);
      await page.setViewportSize({
        width: theme === "dark" ? 390 : 1280,
        height: 900,
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const embedded: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("example.test/unsafe"))
          embedded.push(request.url());
      });
      await page.goto(`/${locale}/tracks/${id}`);
      await selectTheme(page, theme);
      const map = page.locator('.track-map[aria-busy="false"]:visible');
      await expect(map).toBeVisible();
      const marker = map.getByRole("button", {
        name: en ? /2 waypoints; Start/ : /2 puntos de interés; Inicio/,
      });
      await expect(marker).toBeVisible();
      const initial = await marker.locator("..").getAttribute("style");
      const startBox = (await marker.boundingBox())!;
      const endBox = (await map
        .getByRole("img", { name: en ? "End" : "Final", exact: true })
        .boundingBox())!;
      expect(
        Math.hypot(startBox.x - endBox.x, startBox.y - endBox.y),
      ).toBeGreaterThan(100);
      await marker.focus();
      await page.keyboard.press("Enter");
      const popup = map.getByRole("dialog", {
        name: en ? "Waypoints" : "Puntos de interés",
        exact: true,
      });
      await expect(popup).toBeVisible();
      const popupBox = (await popup.boundingBox())!;
      const mapBox = (await map.boundingBox())!;
      expect(popupBox.x).toBeGreaterThanOrEqual(mapBox.x);
      expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(
        mapBox.x + mapBox.width,
      );
      expect(popupBox.y).toBeGreaterThanOrEqual(mapBox.y);
      expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(
        mapBox.y + mapBox.height,
      );
      await expect(popup).toContainText("Spring");
      await expect(popup).toContainText(en ? "Waypoint" : "Punto de interés");
      await expect(popup).toContainText(
        '<img src="https://example.test/unsafe">',
      );
      await expect(popup).toContainText(en ? "Start" : "Inicio");
      await expect(popup.locator("img, a, script")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
      await expect(marker).toBeFocused();
      await marker.click();
      await popup
        .getByRole("button", {
          name: en ? "Close waypoints" : "Cerrar puntos de interés",
        })
        .click();
      await expect(marker).toBeFocused();
      if (theme === "dark") {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setTouchEmulationEnabled", {
          enabled: true,
          maxTouchPoints: 2,
        });
        const tap = async (target: import("@playwright/test").Locator) => {
          const box = (await target.boundingBox())!;
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [
              { id: 0, x: box.x + box.width / 2, y: box.y + box.height / 2 },
            ],
          });
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
        };
        await tap(marker);
        await expect(popup).toBeVisible();
        await tap(
          popup.getByRole("button", {
            name: en ? "Close waypoints" : "Cerrar puntos de interés",
          }),
        );
        await expect(popup).toHaveCount(0);
        await cdp.detach();
      }
      await map
        .getByRole("button", { name: en ? "Zoom out" : "Reducir", exact: true })
        .click();
      await map
        .getByRole("button", {
          name: en ? "Fit recorded path" : "Ajustar al trazado registrado",
          exact: true,
        })
        .click();
      await expect(marker.locator("..")).toHaveAttribute("style", initial!);
      expect(await mapCoordinates(page)).toEqual([
        [-3, 40],
        [-3.001, 40.001],
      ]);
      const offPath = map.getByRole("button", {
        name: en ? "1 waypoint; Off path" : "1 punto de interés; Off path",
        exact: true,
      });
      await expect(offPath).not.toBeInViewport();
      for (let step = 0; step < 18; step++)
        await map
          .getByRole("button", {
            name: en ? "Zoom out" : "Reducir",
            exact: true,
          })
          .click();
      await expect(offPath).toBeInViewport();
      await offPath.click();
      await expect(popup).toContainText("Off path");
      await page.keyboard.press("Escape");
      await map
        .getByRole("button", {
          name: en ? "Fit recorded path" : "Ajustar al trazado registrado",
          exact: true,
        })
        .click();
      expect(embedded).toEqual([]);
      expect(errors).toEqual([]);
      const download = await context.request.get(`/api/tracks/${id}/download`);
      expect(await download.body()).toEqual(bytes);
      await marker.click();
      await expect(popup).toBeVisible();
      await page
        .getByRole("link", {
          name: en ? "Upload another track" : "Subir otro recorrido",
        })
        .click();
      await expect(page.locator("[data-waypoint-marker]:visible")).toHaveCount(
        0,
      );
      await fillTrack(page, en, gpx);
      await page
        .getByRole("button", {
          name: en ? "Upload track" : "Subir recorrido",
          exact: true,
        })
        .click();
      await expect(map).toBeVisible();
      await expect(map.locator("[data-waypoint-marker]")).toHaveCount(0);
    });
  }
}

test("waypoints wrap at the dateline, paginate without losing coincident entries and dismiss on canvas click", async ({
  context,
  page,
  baseURL,
}) => {
  await account(context, baseURL!);
  const points = Array.from(
    { length: 51 },
    (_, index) =>
      `<wpt lat="0" lon="${index % 2 ? -180 : 180}"><name>Point ${index + 1}</name></wpt>`,
  ).join("");
  const bytes = Buffer.from(
    `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">${points}<trk><trkseg><trkpt lat="0" lon="179.99"/><trkpt lat="0" lon="-179.99"/></trkseg></trk></gpx>`,
  );
  const id = await createAnalyticsTrack(context, baseURL!, bytes);
  await page.goto(`/en/tracks/${id}`);
  const map = page.locator('.track-map[aria-busy="false"]:visible');
  await expect(map).toBeVisible();
  const marker = map.getByRole("button", {
    name: "51 waypoints; Point 1",
    exact: true,
  });
  await expect(marker).toBeVisible();
  await marker.click();
  const popup = map.getByRole("dialog", { name: "Waypoints", exact: true });
  await expect(popup).toContainText("Point 1");
  await expect(popup).not.toContainText("Point 51");
  await popup.getByRole("button", { name: "Next waypoints" }).click();
  await expect(popup).toContainText("Point 51");
  await expect(popup).not.toContainText("Point 50");
  const canvas = map.locator("canvas");
  const canvasBox = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: canvasBox.width - 20, y: 220 } });
  await expect(popup).toHaveCount(0);
  await expect(marker).toBeFocused();
  expect(await mapCoordinates(page)).toEqual([
    [179.99, 0],
    [180.01, 0],
  ]);
});

test("waypoint location pages keep every marker reachable with bounded rendered controls", async ({
  context,
  page,
  baseURL,
}) => {
  await account(context, baseURL!);
  const points = Array.from(
    { length: 101 },
    (_, index) =>
      `<wpt lat="40" lon="${-3 + index * 0.000001}"><name>Location ${index + 1}</name></wpt>`,
  ).join("");
  const id = await createAnalyticsTrack(
    context,
    baseURL!,
    Buffer.from(gpx.toString().replace("<trk>", points + "<trk>")),
  );
  await page.goto(`/en/tracks/${id}`);
  const map = page.locator('.track-map[aria-busy="false"]:visible');
  await expect(map).toBeVisible();
  await expect(map.locator("[data-waypoint-marker]")).toHaveCount(100);
  await expect(
    map.getByRole("group", { name: "Waypoint pages" }),
  ).toContainText("1–100 of 101");
  await map.getByRole("button", { name: "Next waypoints" }).click();
  await expect(map.locator("[data-waypoint-marker]")).toHaveCount(1);
  await map.locator("[data-waypoint-marker]").click();
  await expect(
    map.getByRole("dialog", { name: "Waypoints", exact: true }),
  ).toContainText("Location 101");
  await page.keyboard.press("Escape");
  await map.getByRole("button", { name: "Previous waypoints" }).click();
  await expect(map.locator("[data-waypoint-marker]")).toHaveCount(100);
});

test("waypoint grouping preserves distinct precise positions and coincident endpoints in wrapped worlds", async ({
  context,
  page,
  baseURL,
}) => {
  await account(context, baseURL!);
  const bytes = Buffer.from(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><wpt lat="0" lon="0"><name>Exact start</name></wpt><wpt lat="0" lon="0.000000000000001"><name>Nearby</name></wpt><wpt lat="1" lon="-179.999"><name>Wrapped end</name></wpt><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="1"/></trkseg><trkseg><trkpt lat="1" lon="179.999"/><trkpt lat="1" lon="-179.999"/></trkseg></trk></gpx>',
  );
  const id = await createAnalyticsTrack(context, baseURL!, bytes);
  await page.goto(`/en/tracks/${id}`);
  const map = page.locator('.track-map[aria-busy="false"]:visible');
  await expect(map).toBeVisible();
  await expect(map.locator("[data-waypoint-marker]")).toHaveCount(3);
  await expect(
    map.getByRole("button", {
      name: "1 waypoint; Segment 1: Start; Exact start",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    map.getByRole("button", { name: "1 waypoint; Nearby", exact: true }),
  ).toHaveCount(1);
  await expect(
    map.getByRole("button", {
      name: "1 waypoint; Segment 2: End; Wrapped end",
      exact: true,
    }),
  ).toHaveCount(1);
});

for (const locale of ["en", "es", "fr", "pt", "de", "it"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} photo draft rejects malformed success and retains caption focus across retry`, async ({
      page,
      context,
      baseURL,
    }) => {
      const messages = JSON.parse(
        await readFile(`messages/${locale}.json`, "utf8"),
      );
      await account(context, baseURL!);
      await page.goto(`/${locale}/tracks/upload`);
      await selectTheme(page, theme);
      const photos = page.getByRole("region", {
        name: messages.Photos.title,
        exact: true,
      });
      let attempt = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/files?purpose=photo", async (route) => {
        attempt++;
        if (attempt > 1) await gate;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: attempt === 1 ? null : "11111111-1111-4111-8111-111111111111",
          }),
        });
      });
      const image = await sharp({
        create: { width: 12, height: 12, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      await photos.locator('input[type="file"]').setInputFiles({
        name: "draft.png",
        mimeType: "image/png",
        buffer: image,
      });
      const caption = photos.getByRole("textbox");
      await caption.fill("Retained caption");
      const retry = photos.getByRole("button", {
        name: messages.Photos.retry,
        exact: true,
      });
      await expect(retry).toBeVisible();
      await expect(photos.getByRole("status")).toContainText(
        messages.Photos.failed,
      );
      await retry.click();
      await caption.focus();
      release();
      await expect(retry).toHaveCount(0);
      await expect(caption).toHaveValue("Retained caption");
      await expect(caption).toBeFocused();
      await expect(photos.locator("img")).toHaveJSProperty("naturalWidth", 12);
      await photos
        .getByRole("button", { name: messages.Photos.remove, exact: true })
        .click();
      await expect(photos.getByRole("listitem")).toHaveCount(0);
      expect(attempt).toBe(2);
    });
  }
}

import { expect, test, selectTheme } from "./fixtures";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import sharp from "sharp";
import type { BrowserContext } from "@playwright/test";
import { stubBasemap, mapCoordinates, observeMap } from "../helpers/map";
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
  for (const id of owners) {
    await pool.query("DELETE FROM tracks WHERE owner_id=$1", [id]);
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [id]);
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
  }
  owners.clear();
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
      await expect(hiking).toBeEnabled();
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
      await submit.click();
      await expect(form.getByRole("alert")).toBeVisible();
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
        await expect(submit).toBeEnabled();
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
          : "marcas de tiempo, metadatos del autor, puntos de referencia y otras ubicaciones",
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
        name: en ? "Download original GPX" : "Descargar GPX original",
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
        labels.length,
        labels.difficulty,
        labels.analytics.range,
        labels.analytics.ascent,
        labels.analytics.descent,
      ]);
      await expect(stats.locator("dd").nth(1)).toHaveText("3 / 5");
      // Multiple climbs distinguish elevation range from cumulative ascent.
      await expect(stats.locator("dd").nth(2)).toHaveText("20 m");
      await expect(stats.locator("dd").nth(3)).toHaveText("25 m");
      await expect(stats.locator("dd").nth(4)).toHaveText("5 m");
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
          expect(title!.y).toBe(download!.y);
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
  await expect(map.getByText("Start", { exact: true })).toBeVisible();
  await expect(map.getByText("End", { exact: true })).toBeVisible();
  await expect(
    map.getByRole("link", { name: "OpenFreeMap", exact: true }),
  ).toBeVisible();
  await page.unroute("https://tiles.openfreemap.org/**");
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  await page.reload();
  await expect(map.getByRole("alert")).toHaveText(
    enMessages.Tracks.map.outdoorFailure,
  );
  expect(await mapCoordinates(page)).toEqual([
    [-3, 40],
    [-3.001, 40.001],
  ]);
  const download = page.getByRole("link", { name: "Download original GPX" });
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
      const marker = map.getByText(en ? "Start / end" : "Inicio / final", {
        exact: true,
      });
      await expect(marker).toBeVisible();
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
    for (const basemap of ["outdoor", "topographic"] as const) {
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
          basemap === "outdoor"
            ? "https://tiles.openfreemap.org/outdoor-fixture/"
            : "https://tile.opentopomap.org/";
        const credits =
          basemap === "outdoor"
            ? ["OpenStreetMap", "OpenFreeMap", "OpenMapTiles"]
            : ["OpenStreetMap", "SRTM", "Sonny", "OpenTopoMap", "CC BY-SA 3.0"];
        const provider = basemap === "outdoor" ? "OpenFreeMap" : "OpenTopoMap";
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
        await expect(selector).toHaveValue("outdoor");
        if (basemap === "outdoor")
          await expect.poll(() => outdoorRequests.length).toBeGreaterThan(0);
        expect(topographicRequests).toHaveLength(0);
        await expect(
          selector.locator('option:not([value="satellite"])'),
        ).toHaveText(
          en
            ? ["Street", "Outdoors", "Topographic"]
            : ["Callejero", "Aire libre", "Topográfico"],
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
        if (basemap === "outdoor") expect(topographicRequests).toHaveLength(0);
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
          basemap === "outdoor" ? "topographic" : "outdoor",
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
      await expect(map.getByRole("alert")).toContainText(
        asset === "topographic"
          ? "Topographic tiles could not be loaded"
          : "Outdoors tiles could not be loaded",
      );
    }
    await expect(map.locator("canvas")).toBeVisible();
    await expect(map.locator(".maplibregl-marker")).toHaveCount(2);
    await expect(
      page.getByRole("link", { name: "Download original GPX" }),
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
      await expect(map.getByRole("alert")).toContainText(
        basemap === "outdoor"
          ? "Outdoors tiles could not be loaded"
          : "Topographic tiles could not be loaded",
      );
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
  await expect(selector).toHaveValue("outdoor");
  await page.getByRole("link", { name: "Español", exact: true }).click();
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
              type: "LineString",
              coordinates: [
                [null, 4],
                [1, 2],
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
      await expect(map.getByRole("alert")).toHaveText(
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
      page.getByRole("link", { name: "Download original GPX" }),
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
    headers: { origin: baseURL },
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
        .locator("dd")
        .nth(2);
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
          name: en ? "Download original GPX" : "Descargar GPX original",
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
          name: en ? "Download original GPX" : "Descargar GPX original",
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
  await expect(
    elevation.getByRole("button", { name: "Next section" }),
  ).toBeVisible();
  const renderedMilliseconds = Math.round(performance.now() - started);
  await expect(
    elevation.getByRole("status").filter({ hasText: "Chart section" }),
  ).toContainText("1 / 63");
  const interactionStarted = performance.now();
  await elevation.getByRole("button", { name: "Next section" }).click();
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
        elevationCount++ < 800 ? elevation : "",
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
        name: en ? "Download original GPX" : "Descargar GPX original",
      });
      const url = (await download.getAttribute("href"))!;
      const original = await context.request.get(url);
      expect(original.status()).toBe(200);
      expect(await original.body()).toEqual(gpx);
      expect(original.headers()["cache-control"]).toBe("private, no-store");
      const detailsURL = page.url();
      expect((await request.get(url)).status()).toBe(404);
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
      en ? "exactly one track" : "exactamente un recorrido",
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
    await page
      .getByLabel(en ? "Name" : "Nombre", { exact: true })
      .fill("Changed ridge");
    await submit.click();
    await expect(
      page.getByLabel(en ? "Name" : "Nombre", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(ids[2]).not.toBe(ids[0]);
    await submit.click();
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
    expect(ids[4]).toBe(ids[2]);
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
    await submit.click();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(description).toHaveAttribute("aria-invalid", "true");
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

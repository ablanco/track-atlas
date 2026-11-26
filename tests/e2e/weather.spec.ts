import { test, expect, selectTheme } from "./fixtures";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { locales } from "../../i18n/locales";
import { acceptFixtureDocuments } from "../helpers/legal-evidence";
import { stubBasemap } from "../helpers/map";
import type en from "../../messages/en.json";
loadEnvConfig(process.cwd(), true);
let pool: Pool;
const owners = new Set<string>();
test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});
test.afterAll(() => pool.end());
test.afterEach(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const id of owners) {
      await client.query(
        "DELETE FROM track_upload_attempts WHERE owner_id=$1",
        [id],
      );
      await client.query("DELETE FROM tracks WHERE owner_id=$1", [id]);
      await client.query("DELETE FROM stored_files WHERE owner_id=$1", [id]);
      await client.query("DELETE FROM users WHERE id=$1", [id]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  owners.clear();
});
for (const locale of locales)
  for (const theme of ["light", "dark"] as const)
    test(`${locale} ${theme} weather displays local forecast and leaves details usable after provider failure`, async ({
      page,
      context,
      baseURL,
    }) => {
      const m = JSON.parse(
        await readFile(`messages/${locale}.json`, "utf8"),
      ) as typeof en;
      const {
        rows: [owner],
      } = await pool.query(
        "INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth,email_confirmed) VALUES('Ada','Lovelace',$1,'synthetic','1815-12-10',true) RETURNING id",
        [`weather-${randomUUID()}@example.test`],
      );
      owners.add(owner.id);
      await acceptFixtureDocuments(pool, owner.id);
      const token = randomBytes(32).toString("base64url");
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
          sameSite: "Lax",
        },
      ]);
      const ids: string[] = [];
      for (const lat of [40, 41]) {
        const response = await context.request.post("/api/tracks", {
          headers: { origin: baseURL! },
          multipart: {
            name: "Weather ridge",
            description: "Recorded in 2001",
            activity: "hiking",
            difficulty: "3",
            tags: "[]",
            visibility: "public",
            requestId: randomUUID(),
            file: {
              name: "weather.gpx",
              mimeType: "application/gpx+xml",
              buffer: Buffer.from(
                `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="weather"><trk><trkseg><trkpt lat="${lat}" lon="-3"><time>2001-01-01T00:00:00Z</time></trkpt><trkpt lat="${lat}.001" lon="-3.001"><time>2001-01-01T00:01:00Z</time></trkpt></trkseg></trk></gpx>`,
              ),
            },
          },
        });
        expect(response.status()).toBe(201);
        ids.push((await response.json()).id);
      }
      await context.clearCookies(); // public Track, anonymous weather
      await stubBasemap(page);
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      const outgoing: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("met.no")) outgoing.push(request.url());
      });
      await page.goto(`/${locale}/tracks/${ids[0]}`);
      await selectTheme(page, theme);
      const weather = page.getByRole("region", {
        name: m.Tracks.weather.title,
        exact: true,
      });
      await expect(weather).toContainText(m.Tracks.weather.selectDay);
      await expect(weather).toContainText(m.Tracks.weather.conditions.rain);
      await expect(weather).toContainText("12 °C");
      const days = weather.locator("button[aria-expanded]");
      await expect(days).toHaveCount(6);
      const dayList = days.first().locator("xpath=../..");
      expect(
        await dayList.evaluate((list) => list.scrollWidth <= list.clientWidth),
      ).toBe(true);
      const popup = page.getByRole("dialog");
      await expect(popup).toHaveCount(0);
      const before = await weather.boundingBox();
      await expect(days.first()).toHaveAttribute("aria-expanded", "false");
      await days.first().click();
      await expect(days.first()).toHaveAttribute("aria-expanded", "true");
      await expect(popup).toBeVisible();
      const firstPanel = popup;
      const firstDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Madrid",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const firstTimes = await firstPanel
        .locator("time")
        .evaluateAll((items) =>
          items.map((item) => item.getAttribute("datetime")!),
        );
      expect(firstTimes.length).toBeGreaterThan(0);
      await expect(popup.getByRole("heading")).toHaveText(
        new Intl.DateTimeFormat(locale, {
          timeZone: "Europe/Madrid",
          weekday: "long",
          month: "long",
          day: "numeric",
        }).format(new Date(firstTimes[0])),
      );
      expect(firstTimes.length).toBeLessThanOrEqual(4);
      expect(
        new Set(firstTimes.map((time) => firstDate.format(new Date(time))))
          .size,
      ).toBe(1);
      await expect
        .poll(async () => {
          const box = await popup.boundingBox();
          const viewport = page.viewportSize()!;
          return (
            box !== null &&
            box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= viewport.width &&
            box.y + box.height <= viewport.height
          );
        })
        .toBe(true);
      expect((await weather.boundingBox())!.height).toBe(before!.height);
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
      await expect(days.first()).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(popup).toBeVisible();
      await days.nth(1).click();
      await expect(popup).toHaveCount(1);
      await expect(days.first()).toHaveAttribute("aria-expanded", "false");
      await expect(days.nth(1)).toHaveAttribute("aria-expanded", "true");
      await popup
        .getByRole("button", { name: m.Auth.close, exact: true })
        .click();
      await expect(popup).toHaveCount(0);
      await expect(days.nth(1)).toBeFocused();
      const times: string[] = [];
      let detailsText = "";
      for (const day of await days.all()) {
        await day.click();
        await expect(popup).toBeVisible();
        times.push(
          ...(await popup
            .locator("time")
            .evaluateAll((items) =>
              items.map((item) => item.getAttribute("datetime")!),
            )),
        );
        detailsText += await popup.innerText();
        const first = popup.locator("time").first();
        const instant = await first.getAttribute("datetime");
        expect(new Date(instant!).getUTCFullYear()).toBeGreaterThan(2001);
        await expect(first).toHaveText(
          new Intl.DateTimeFormat(locale, {
            timeZone: "Europe/Madrid",
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(instant!)),
        );
        await day.click();
        await expect(popup).toHaveCount(0);
      }
      expect(
        new Set(times.map((time) => firstDate.format(new Date(time)))).size,
      ).toBe(6);
      expect(times.length).toBeLessThanOrEqual(24);
      expect(detailsText).toContain("18 km/h");
      expect(detailsText).toContain(m.Tracks.weather.missing);
      await days.first().click();
      await weather.getByRole("heading").click();
      await expect(popup).toHaveCount(0);
      await expect(
        weather.getByRole("link", { name: "MET Norway" }),
      ).toHaveAttribute("href", "https://www.met.no/");
      await expect(
        weather.getByRole("link", { name: "CC BY 4.0" }),
      ).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
      await expect(
        weather.getByRole("link", { name: "ODbL", exact: true }),
      ).toHaveAttribute(
        "href",
        "https://opendatacommons.org/licenses/odbl/1-0/",
      );
      expect(outgoing).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await weather.getByRole("link", { name: "MET Norway" }).focus();
      await page.keyboard.press("Tab");
      await expect(
        weather.getByRole("link", { name: "CC BY 4.0" }),
      ).toBeFocused();
      await page.goto(`/${locale}/tracks/${ids[1]}`);
      await expect(
        page.getByRole("heading", { name: "Weather ridge", exact: true }),
      ).toBeVisible();
      await expect(weather.getByRole("status")).toHaveText(
        m.Tracks.weather.unavailable,
      );
      await expect(weather.locator("time")).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: m.Tracks.description, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Recorded in 2001", { exact: true }),
      ).toBeVisible();
    });

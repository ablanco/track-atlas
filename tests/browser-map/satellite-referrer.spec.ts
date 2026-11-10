import { test, expect } from "@playwright/test";
import { stubBasemap } from "../helpers/map";

for (const details of [false, true]) {
  test(`${details ? "details" : "explorer"}: restricted satellite requests send only the origin`, async ({
    page,
    baseURL,
  }) => {
    const otherReferrers: (string | undefined)[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname === "tiles.openfreemap.org")
        otherReferrers.push(request.headers().referer);
    });
    await stubBasemap(page);
    await page.route("**/api/tracks/*/*", (route) =>
      route.fulfill({
        json: {
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [-3, 40],
                [-2.99, 40.01],
              ],
            ],
          },
        },
      }),
    );
    const requests: { kind: string; referrer?: string }[] = [];
    await page.route("https://api.mapbox.com/**", async (route) => {
      const referrer = (await route.request().allHeaders()).referer;
      requests.push({ kind: "metadata", referrer });
      if (referrer !== `${baseURL}/`)
        return route.fulfill({ status: 403, json: { message: "Forbidden" } });
      return route.fulfill({
        json: {
          tilejson: "3.0.0",
          minzoom: 0,
          maxzoom: 16,
          tiles: [
            "https://a.tiles.mapbox.com/satellite-fixture/{z}/{x}/{y}.png",
          ],
          attribution: "Satellite fixture",
        },
      });
    });
    await page.route("https://a.tiles.mapbox.com/**", async (route) => {
      const referrer = (await route.request().allHeaders()).referer;
      requests.push({ kind: "tile", referrer });
      if (referrer !== `${baseURL}/`) return route.fulfill({ status: 403 });
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWN49vo2AAVnAq1Uf400AAAAAElFTkSuQmCC",
          "base64",
        ),
      });
    });
    await page.goto("/?private-track=fixture&private-query=hidden");
    if (details)
      await page
        .getByRole("button", { name: "Toggle details", exact: true })
        .click();
    const selector = page.getByRole("combobox", {
      name: "Basemap",
      exact: true,
    });
    await expect(selector).toBeEnabled({ timeout: 15_000 });
    // Match private pages' document policy after the local dev chunks load.
    await page.evaluate(() => {
      const meta = document.createElement("meta");
      meta.name = "referrer";
      meta.content = "no-referrer";
      document.head.append(meta);
    });
    if (details) await selector.selectOption("satellite");
    else {
      await selector.click();
      await page
        .getByRole("option", { name: "Satellite", exact: true })
        .click();
    }
    await expect
      .poll(() => requests.filter((r) => r.kind === "tile").length)
      .toBeGreaterThan(0);
    if (details)
      await expect(page.locator('[aria-busy="false"]')).toBeVisible();
    else
      await expect(page.getByText("Loading map…", { exact: true })).toHaveCount(
        0,
      );
    expect(otherReferrers.length).toBeGreaterThan(0);
    expect(otherReferrers.every((referrer) => referrer === undefined)).toBe(
      true,
    );
    expect(requests.every((r) => r.referrer === `${baseURL}/`)).toBe(true);
    await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
  });
}

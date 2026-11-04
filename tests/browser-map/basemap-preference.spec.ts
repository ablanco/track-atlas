import { test, expect } from "@playwright/test";
import { stubBasemap } from "../helpers/map";

const geometry = {
  geometry: {
    type: "MultiLineString",
    coordinates: [
      [
        [-3, 40],
        [-2.99, 40.01],
      ],
    ],
  },
};

for (const locale of ["en", "es"]) {
  for (const initialTheme of ["light", "dark"] as const) {
    test(`${locale} ${initialTheme}: automatic defaults and shared manual overrides survive theme changes and reloads`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          /hydration|did not match|maximum update depth/i.test(message.text())
        )
          errors.push(message.text());
      });
      await page.emulateMedia({ colorScheme: initialTheme });
      await stubBasemap(page);
      await page.route("**/api/tracks/*/explore-geometry", (route) =>
        route.fulfill({ json: geometry }),
      );
      await page.route("**/api/tracks/*/data", (route) =>
        route.fulfill({ json: geometry }),
      );
      await page.goto("/");
      if (locale === "es")
        await page
          .getByRole("button", { name: "Language", exact: true })
          .click();
      const selector = page.getByRole("combobox", {
        name: locale === "en" ? "Basemap" : "Mapa base",
        exact: true,
      });
      const displayed = selector.locator('[data-slot="select-value"]');
      const outdoor = locale === "en" ? "Outdoors" : "Aire libre";
      const dark = locale === "en" ? "Dark" : "Oscuro";
      await expect(displayed).toHaveText(
        initialTheme === "dark" ? dark : outdoor,
      );
      await expect(page.getByLabel("Camera bounds")).not.toHaveText("null");
      const bounds = await page.getByLabel("Camera bounds").textContent();
      // No stored choice: changes to the system theme also change the map.
      await page.emulateMedia({
        colorScheme: initialTheme === "dark" ? "light" : "dark",
      });
      await expect(displayed).toHaveText(
        initialTheme === "dark" ? outdoor : dark,
      );
      await expect(page.getByLabel("Camera bounds")).toHaveText(bounds!);
      expect(
        await page.evaluate(() => localStorage.getItem("track-atlas-basemap")),
      ).toBeNull();
      await page
        .getByRole("button", { name: "Toggle details", exact: true })
        .click();
      await expect(selector).toHaveValue(
        initialTheme === "dark" ? "outdoor" : "dark",
      );
      await expect(selector).toBeEnabled();
      await selector.selectOption("street");
      await page.getByRole("button", { name: "Dark", exact: true }).click();
      await expect(selector).toHaveValue("street");
      await page
        .getByRole("button", { name: "Toggle details", exact: true })
        .click();
      await expect(displayed).toHaveText(
        locale === "en" ? "Street" : "Callejero",
      );
      await selector.click();
      await page.getByRole("option", { name: dark, exact: true }).click();
      await page.getByRole("button", { name: "Light", exact: true }).click();
      await expect(displayed).toHaveText(dark);
      await page.reload();
      // The harness resets its locale on reload, but the basemap persists.
      const reloaded = page.getByRole("combobox", {
        name: "Basemap",
        exact: true,
      });
      await expect(reloaded).toContainText("Dark");
      await page
        .getByRole("button", { name: "Toggle details", exact: true })
        .click();
      await expect(reloaded).toHaveValue("dark");
      await expect(page.locator('[aria-busy="false"]')).toBeVisible();
      expect(
        await page.evaluate(() => localStorage.getItem("track-atlas-basemap")),
      ).toBe("dark");
      expect(errors).toEqual([]);
    });
  }
}

test("invalid stored choices fall back to theme defaults; valid selections synchronize between tabs", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await stubBasemap(page);
  await page.route("**/api/tracks/*/explore-geometry", (route) =>
    route.fulfill({ json: geometry }),
  );
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem("track-atlas-basemap", "invalid"),
  );
  await page.reload();
  const selector = page.getByRole("combobox", { name: "Basemap", exact: true });
  await expect(selector).toContainText("Dark");
  const other = await context.newPage();
  await stubBasemap(other);
  await other.route("**/api/tracks/*/explore-geometry", (route) =>
    route.fulfill({ json: geometry }),
  );
  await other.goto("/");
  await expect(
    other.getByRole("combobox", { name: "Basemap", exact: true }),
  ).toBeVisible();
  await selector.click();
  await page.getByRole("option", { name: "Street", exact: true }).click();
  await expect(
    other.getByRole("combobox", { name: "Basemap", exact: true }),
  ).toContainText("Street");
  await other.close();
});

for (const blocked of ["all", "writes"] as const) {
  test(`manual choices still work when storage blocks ${blocked}`, async ({
    page,
  }) => {
    await page.addInitScript((blocked) => {
      Storage.prototype.setItem = () => {
        throw Error("Blocked storage");
      };
      if (blocked === "all")
        Storage.prototype.getItem = () => {
          throw Error("Blocked storage");
        };
    }, blocked);
    await stubBasemap(page);
    await page.route("**/api/tracks/*/explore-geometry", (route) =>
      route.fulfill({ json: geometry }),
    );
    await page.goto("/");
    const selector = page.getByRole("combobox", {
      name: "Basemap",
      exact: true,
    });
    await selector.click();
    await page.getByRole("option", { name: "Dark", exact: true }).click();
    await expect(selector).toContainText("Dark");
    await page
      .getByRole("button", { name: "Toggle activity", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Toggle activity", exact: true })
      .click();
    await expect(selector).toContainText("Dark");
  });
}

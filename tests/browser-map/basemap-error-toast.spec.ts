import { test, expect } from "@playwright/test";
import { stubBasemap } from "../helpers/map";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import pt from "../../messages/pt.json";
import de from "../../messages/de.json";
import it from "../../messages/it.json";

for (const [locale, messages] of Object.entries({ en, es, fr, pt, de, it })) {
  for (const theme of ["light", "dark"] as const) {
    for (const details of [false, true]) {
      test(`${locale} ${theme} ${details ? "details" : "explorer"}: basemap failure uses one error toast and allows retry`, async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (/hydration|did not match/i.test(message.text()))
            errors.push(message.text());
        });
        await page.emulateMedia({ colorScheme: theme });
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
        await page.route("https://tile.opentopomap.org/**", (route) =>
          route.fulfill({ status: 403 }),
        );
        await page.goto("/");
        if (locale !== "en")
          await page
            .getByRole("button", { name: `Locale ${locale}`, exact: true })
            .click();
        if (details)
          await page
            .getByRole("button", { name: "Toggle details", exact: true })
            .click();
        const selector = page.getByRole("combobox", {
          name: messages.Tracks.map.basemap,
          exact: true,
        });
        const choose = async (value: string, label: string) => {
          await expect(selector).toBeEnabled();
          if (details) await selector.selectOption(value);
          else {
            await selector.click();
            await page
              .getByRole("option", { name: label, exact: true })
              .click();
          }
        };
        await choose("topographic", messages.Tracks.map.topographic);
        const notification = page.locator('[data-slot="toast"]');
        const message = details
          ? messages.Tracks.map.topographicFailure
          : messages.ExploreMap.basemapFailure;
        await expect(notification).toHaveCount(1);
        await expect(notification).toContainText(message);
        await expect(
          notification.locator('[data-slot="toast-icon"] svg'),
        ).toHaveClass(/text-destructive/);
        await expect(
          page.locator("p[role=alert]").filter({ hasText: message }),
        ).toHaveCount(0);
        await expect(selector).toBeEnabled();
        await notification.locator('[data-slot="toast-close"]').click();
        await expect(notification).toHaveCount(0);
        await choose("street", messages.Tracks.map.street);
        await choose("topographic", messages.Tracks.map.topographic);
        await expect(notification).toHaveCount(1);
        await expect(notification).toContainText(message);
        expect(errors).toEqual([]);
      });
    }
  }
}

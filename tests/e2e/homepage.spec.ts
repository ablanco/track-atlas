import { selectTheme, expect, expectTheme, test } from "./fixtures";
for (const locale of ["en", "es"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [375, 1440]) {
      test(`${locale} ${theme} at ${width}px: accessible responsive homepage`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(`/${locale}`);
        await expectTheme(page, theme);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          locale === "en"
            ? "Find your way.Make it an adventure."
            : "Encuentra tu rumbo.Vive una aventura.",
        );
        for (const id of ["map-search", "activities", "open-source"])
          await expect(page.locator(`#${id}`)).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const tabs = page.getByRole("tablist");
        await expect(tabs.getByRole("tab")).toHaveCount(3);
        await tabs.getByRole("tab").first().focus();
        await page.keyboard.press("ArrowRight");
        await expect(tabs.getByRole("tab").nth(1)).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expect(tabs.getByRole("tab").nth(1)).toBeFocused();
        await page.keyboard.press("End");
        await expect(tabs.getByRole("tab").last()).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expect(page.getByRole("tabpanel")).toContainText(
          locale === "en" ? "whichever way" : "cualquiera de los dos",
        );
        const hero = page.getByRole("main").locator(":scope > section").first();
        await expect(hero.locator(`a[href='/${locale}/tracks']`)).toBeVisible();
        await expect(
          hero.locator(`a[href='/${locale}/tracks/upload?login=1']`),
        ).toBeVisible();
        const footer = page.getByRole("contentinfo");
        await expect(footer.getByRole("switch")).toBeVisible();
        await expect(
          footer.getByRole("link", { name: "English", exact: true }),
        ).toBeVisible();
        await expect(
          footer.getByRole("link", { name: "Español", exact: true }),
        ).toBeVisible();
        if (width === 375) {
          const menu = page.locator("header details");
          await menu.locator("summary").click();
          await menu.locator('a[href="#activities"]').click();
          await expect(menu).not.toHaveAttribute("open", "");
        } else
          await expect(
            page.getByRole("link", {
              name: locale === "en" ? "Activities" : "Actividades",
              exact: true,
            }),
          ).toBeVisible();
        await page.goto(`/${locale}`);
        await page.keyboard.press("Tab");
        await expect(page.locator('a[href="#main-content"]')).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("main")).toBeFocused();
        await page.emulateMedia({ reducedMotion: "reduce" });
        const button = hero.locator(`a[href='/${locale}/tracks']`);
        await expect(button).toHaveCSS("transition-duration", "0s");
        await page.screenshot({
          path: `/tmp/track-atlas-home-${locale}-${theme}-${width}.png`,
          fullPage: true,
        });
      });
    }
test("native language navigation remembers preference and preserves theme", async ({
  page,
  context,
}) => {
  await page.goto("/en");
  await selectTheme(page, "dark");
  await page.getByRole("link", { name: "Español", exact: true }).click();
  await expect(page).toHaveURL(/\/es$/);
  await expectTheme(page, "dark");
  expect(
    (await context.cookies()).find((c) => c.name === "NEXT_LOCALE")?.value,
  ).toBe("es");
  await page.goto("/");
  await expect(page).toHaveURL(/\/es$/);
  await page.getByRole("link", { name: "English", exact: true }).click();
  await expectTheme(page, "dark");
});

test("activity discovery preserves application chrome and returns to the marketing page", async ({
  page,
}) => {
  const { stubBasemap } = await import("../helpers/map");
  await stubBasemap(page);
  await page.goto("/en");
  await page.locator('#activities a[href*="activity=walking"]').click();
  await expect(page).toHaveURL(
    /\/en\/tracks\?activity=walking&activity=hiking&activity=road_running&activity=trail_running$/,
  );
  await expect(page.getByRole("contentinfo")).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: "Activities", exact: true }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("contentinfo")).toBeVisible();
});

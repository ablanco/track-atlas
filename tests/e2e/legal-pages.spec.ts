import {
  test,
  expect,
  selectTheme,
  selectLanguage,
  expectTheme,
} from "./fixtures";

for (const locale of ["en", "es"]) {
  test(`explorer ${locale} exposes legal links through a keyboard accessible compact menu`, async ({
    page,
  }) => {
    await page.route("**/api/tracks/explore?*", (route) =>
      route.fulfill({ status: 503, json: { error: "unavailable" } }),
    );
    await page.goto(`/${locale}/tracks`);
    await expect(page.getByRole("contentinfo")).toBeHidden();
    const menu = page.locator("summary").filter({
      hasText: locale === "en" ? "Legal information" : "Información legal",
    });
    await menu.focus();
    await expect(menu).toBeFocused();
    await page.keyboard.press("Enter");
    const nav = page.getByRole("navigation", {
      name: locale === "en" ? "Legal information" : "Información legal",
      exact: true,
    });
    await expect(nav).toBeVisible();
    await page.keyboard.press("Tab");
    const terms = nav.getByRole("link", {
      name: locale === "en" ? "Terms and Conditions" : "Términos y condiciones",
    });
    await expect(terms).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/${locale}/legal/terms$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      locale === "en" ? "Terms and Conditions" : "Términos y condiciones",
    );
  });
}

for (const locale of ["en", "es"]) {
  for (const theme of ["light", "dark"] as const) {
    test(`legal pages ${locale} ${theme} preserve locale, revision and theme through navigation`, async ({
      page,
    }) => {
      await page.goto(`/${locale}`);
      await selectTheme(page, theme);
      const footer = page.getByRole("contentinfo");
      await footer
        .getByRole("link", {
          name: locale === "en" ? "Privacy Policy" : "Política de privacidad",
        })
        .click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/legal/privacy$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        locale === "en" ? "Privacy Policy" : "Política de privacidad",
      );
      await page
        .getByRole("link", {
          name:
            locale === "en"
              ? "Permanent link to this revision"
              : "Enlace permanente a esta revisión",
        })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/legal/privacy/2026-11-03$`),
      );
      const originalText = await page
        .getByRole("main")
        .locator("[data-legal-text]")
        .innerText();
      await page.reload();
      await expect(
        page.getByRole("main").locator("[data-legal-text]"),
      ).toHaveText(originalText, { useInnerText: true });
      await selectLanguage(page, locale === "en" ? "Español" : "English");
      const other = locale === "en" ? "es" : "en";
      await expect(page).toHaveURL(
        new RegExp(`/${other}/legal/privacy/2026-11-03$`),
      );
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        other === "en" ? "Privacy Policy" : "Política de privacidad",
      );
      await expectTheme(page, theme);
      const contents = page.getByRole("navigation", {
        name: other === "en" ? "Contents" : "Índice",
        exact: true,
      });
      const first = contents.getByRole("link").first();
      await first.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(
        new RegExp(`#legal-${other}-privacy-2026-11-03-revision-1$`),
      );
      await expect(
        page.getByRole("heading", {
          level: 2,
          name:
            other === "en"
              ? "Controller and contact"
              : "Responsable y contacto",
          exact: true,
        }),
      ).toBeInViewport();
      await page
        .getByRole("contentinfo")
        .getByRole("link", {
          name:
            other === "en" ? "Terms and Conditions" : "Términos y condiciones",
        })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        other === "en" ? "Terms and Conditions" : "Términos y condiciones",
      );
      await expectTheme(page, theme);
    });
  }
}

test("mobile legal navigation remains reachable and closes with Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/es/legal/terms");
  const menu = page.locator("summary").filter({ hasText: "Información legal" });
  await menu.focus();
  await page.keyboard.press("Space");
  const nav = page
    .getByRole("banner")
    .getByRole("navigation", { name: "Información legal" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Política de privacidad" }).focus();
  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();
  await expect(menu).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

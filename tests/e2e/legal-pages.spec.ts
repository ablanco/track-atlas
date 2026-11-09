import {
  test,
  expect,
  selectTheme,
  selectLanguage,
  expectTheme,
} from "./fixtures";

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
        new RegExp(`/${locale}/legal/privacy/2026-11-09$`),
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
        new RegExp(`/${other}/legal/privacy/2026-11-09$`),
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
        new RegExp(`#legal-${other}-privacy-2026-11-09-revision-1$`),
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

test("mobile footer legal links remain keyboard accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/es/legal/terms");
  const privacy = page.getByRole("contentinfo").getByRole("link", {
    name: "Política de privacidad",
  });
  await privacy.focus();
  await expect(privacy).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/es\/legal\/privacy$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

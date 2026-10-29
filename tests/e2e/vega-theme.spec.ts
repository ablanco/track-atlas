import { expectTheme, test } from "./fixtures";

for (const theme of ["light", "dark"] as const) {
  test(`Track Atlas brand ${theme} palette follows the saved theme in both languages`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("track-atlas-theme", value),
      theme,
    );
    for (const locale of ["en", "es"]) {
      await page.goto(`/${locale}`);
      await expectTheme(page, theme);
    }
  });
}

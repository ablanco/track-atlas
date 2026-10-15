import { expect, expectTheme, test } from "./fixtures";

for (const theme of ["light", "dark"] as const) {
  test(`applies saved ${theme} preference before hydration`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
    await page.addInitScript((preference) => {
      localStorage.setItem("track-atlas-theme", preference);
    }, theme);
    // Leave the inline startup script enabled, but prevent React from hydrating.
    await page.route(/\/_next\/.*\.js(?:\?|$)/, (route) => route.abort());
    await page.goto("/en");
    await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toBeDisabled();
    await expectTheme(page, theme);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`defaults to system with an OS ${colorScheme} preference`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/en");
    await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toHaveValue("system");
    await expectTheme(page, colorScheme);
  });
}

test("explicit preference overrides OS and survives reload and locale navigation", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/en");
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("dark");
  await expectTheme(page, "dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("track-atlas-theme"))).toBe("dark");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toHaveValue("dark");
  await expectTheme(page, "dark");
  await page.goto("/es");
  const select = page.getByRole("combobox", { name: "Tema", exact: true });
  await expect(select).toHaveValue("dark");
  await expect(select.locator("option")).toHaveText(["", "Claro", "Oscuro", "Sistema"]);
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await select.selectOption("light");
  await expectTheme(page, "light");
});

test("follows live OS changes only with system selected", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/en");
  const select = page.getByRole("combobox", { name: "Theme", exact: true });
  await expect(select).toHaveValue("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "dark");
  await select.selectOption("light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "light");
  await select.selectOption("system");
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light");
});

test("translated native controls support keyboard selection and visible focus", async ({ page }) => {
  await page.goto("/es");
  const select = page.getByRole("combobox", { name: "Tema", exact: true });
  await expect(select).toBeEnabled();
  // The homepage has a skip link and navigation before the theme control.
  for (let tabs = 0; tabs < 12 && !(await select.evaluate((element) => element === document.activeElement)); tabs++) {
    await page.keyboard.press("Tab");
  }
  await expect(select).toBeFocused();
  await expect(select).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue("light");
  await expectTheme(page, "light");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("server-rendered selector stays disabled and unselected before hydration", async ({ page }) => {
    await page.goto("/en");
    const select = page.getByRole("combobox", { name: "Theme", exact: true });
    await expect(select).toBeDisabled();
    await expect(select).toHaveValue("");
  });
});

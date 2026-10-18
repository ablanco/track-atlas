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
    const toggle = page.getByRole("switch", { name: "Theme", exact: true });
    await expect(toggle).toBeDisabled();
    await expectTheme(page, theme);
    const indicator = await toggle.locator("span").boundingBox();
    const activeIcon = await toggle.locator("svg").nth(theme === "dark" ? 1 : 0).boundingBox();
    expect(indicator).not.toBeNull();
    expect(activeIcon).not.toBeNull();
    expect(Math.abs(indicator!.x + indicator!.width / 2 - activeIcon!.x - activeIcon!.width / 2)).toBeLessThan(3);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`defaults to system with an OS ${colorScheme} preference and toggles the resolved theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/en");
    const toggle = page.getByRole("switch", { name: "Theme", exact: true });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("aria-checked", String(colorScheme === "dark"));
    await expectTheme(page, colorScheme);
    await expect(toggle.locator("svg")).toHaveCount(2);
    for (const icon of await toggle.locator("svg").all()) await expect(icon).toHaveAttribute("aria-hidden", "true");
    await toggle.click();
    await expectTheme(page, colorScheme === "dark" ? "light" : "dark");
    await expect(toggle).toHaveAttribute("aria-checked", String(colorScheme !== "dark"));
  });
}

test("explicit preference overrides OS and survives reload and locale navigation", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/en");
  await page.getByRole("switch", { name: "Theme", exact: true }).click();
  await expectTheme(page, "dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("track-atlas-theme"))).toBe("dark");
  await page.reload();
  await expect(page.getByRole("switch", { name: "Theme", exact: true })).toBeChecked();
  await expectTheme(page, "dark");
  await page.getByRole("link", { name: "Español", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Tema", exact: true });
  await expect(toggle).toBeChecked();
  await expect(toggle).toHaveAttribute("title", "Cambiar al tema claro");
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await toggle.click();
  await expectTheme(page, "light");
  await expect(toggle).toHaveAttribute("title", "Cambiar al tema oscuro");
});

test("follows live OS changes until explicitly toggled", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/en");
  const toggle = page.getByRole("switch", { name: "Theme", exact: true });
  await expect(toggle).toBeEnabled();
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "dark");
  await expect(toggle).toBeChecked();
  await toggle.click();
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "light");
  await expect(toggle).not.toBeChecked();
});

test("translated switch supports keyboard toggling and visible focus", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/es");
  const toggle = page.getByRole("switch", { name: "Tema", exact: true });
  await expect(toggle).toBeEnabled();
  for (let tabs = 0; tabs < 12 && !(await toggle.evaluate((element) => element === document.activeElement)); tabs++) {
    await page.keyboard.press("Tab");
  }
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await expectTheme(page, "dark");
  await page.keyboard.press("Enter");
  await expect(toggle).not.toBeChecked();
  await expectTheme(page, "light");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("server-rendered switch stays disabled before hydration", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByRole("switch", { name: "Theme", exact: true })).toBeDisabled();
  });
});

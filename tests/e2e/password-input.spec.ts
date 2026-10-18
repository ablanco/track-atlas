import { expect, test } from "./fixtures";

for (const locale of ["en", "es"]) for (const theme of ["light", "dark"] as const) {
  test(`${locale} ${theme} password visibility works in signup and login`, async ({ page }) => {
    const show = locale === "en" ? "Show password" : "Mostrar contraseña";
    const hide = locale === "en" ? "Hide password" : "Ocultar contraseña";
    await page.setViewportSize({ width: 375, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`/${locale}/signup`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const input = page.locator('main input[name="password"]');
    const toggle = input.locator("..").getByRole("button");
    await expect(toggle).toHaveAccessibleName(show);
    await expect(input).toHaveAttribute("type", "password");
    await input.fill(" a secret é ");
    await input.focus();
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(input).toHaveAttribute("type", "text");
    await expect(input).toHaveValue(" a secret é ");
    await expect(input).toHaveAttribute("autocomplete", "new-password");
    await expect(input).toHaveAttribute("aria-describedby", "password-hint");
    await expect(toggle).toHaveAccessibleName(hide);
    await expect(toggle).toHaveAttribute("aria-controls", "password");
    const fieldBox = await input.boundingBox(), buttonBox = await toggle.boundingBox();
    expect(fieldBox && buttonBox && buttonBox.x >= fieldBox.x && buttonBox.x + buttonBox.width <= fieldBox.x + fieldBox.width).toBe(true);
    await page.keyboard.press("Space");
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveValue(" a secret é ");
    await expect(page.locator("main form")).toHaveAttribute("aria-busy", "false");

    await page.getByRole("button", { name: locale === "en" ? "Log in" : "Iniciar sesión", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const loginInput = dialog.locator('input[name="password"]');
    await expect(loginInput).toHaveAttribute("type", "password");
    await loginInput.fill("login secret");
    await dialog.getByRole("button", { name: show, exact: true }).click();
    await expect(loginInput).toHaveAttribute("type", "text");
    await expect(loginInput).toHaveValue("login secret");
    await expect(input).toHaveAttribute("type", "password");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: locale === "en" ? "Log in" : "Iniciar sesión", exact: true }).click();
    await expect(loginInput).toHaveAttribute("type", "password");
    await expect(loginInput).toHaveValue("");
  });
}

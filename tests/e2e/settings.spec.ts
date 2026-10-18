import { selectTheme, expect, test, expectTheme } from "./fixtures";
import { createHash, randomUUID, scryptSync } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import type { Page } from "@playwright/test";
import { solveCaptcha } from "./captcha-helpers";

loadEnvConfig(process.cwd(), true);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const owned = new Set<string>(), proofs = new Set<string>();
const salt = Buffer.alloc(16, 9);
const hash = `$scrypt$v=1$N=32768,r=8,p=3$${salt.toString("base64url")}$${scryptSync("old password", salt, 64, { N: 32768, r: 8, p: 3, maxmem: 67108864 }).toString("base64url")}`;
test.describe.configure({ mode: "default" });
test.afterEach(async () => {
  for (const email of owned) await pool.query("DELETE FROM users WHERE email=$1", [email]);
  for (const proof of proofs) await pool.query("DELETE FROM captcha_uses WHERE challenge_hash=$1", [proof]);
  owned.clear(); proofs.clear();
});
test.afterAll(() => pool.end());
async function account() {
  const email = `browser-settings-${randomUUID()}@example.test`; owned.add(email);
  await pool.query("INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES('Ada','Lovelace',$1,$2,'1815-12-10')", [email, hash]);
  return email;
}
async function login(page: Page, email: string, locale = "en", password = "old password") {
  await page.goto(`/${locale}`);
  await page.getByRole("button", { name: locale === "en" ? "Log in" : "Iniciar sesión", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('[name="email"]').fill(email); await dialog.locator('[name="password"]').fill(password);
  proofs.add(await solveCaptcha(page, dialog));
  await dialog.getByRole("button", { name: locale === "en" ? "Log in" : "Iniciar sesión", exact: true }).click();
}
async function settings(page: Page, email: string, locale = "en") {
  await login(page, email, locale);
  await page.getByRole("button", { name: "Ada L.", exact: true }).click();
  await page.getByRole("menuitem", { name: locale === "en" ? "Settings" : "Ajustes", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/settings$`));
}
function passwordForm(page: Page, locale = "en") { return page.getByRole("form", { name: locale === "en" ? "Password" : "Contraseña", exact: true }); }
async function fillPassword(page: Page, locale = "en", password = " new password ") {
  const form = passwordForm(page, locale);
  await form.locator('[name="password"]').fill(password); await form.locator('[name="passwordConfirmation"]').fill(password);
  await form.getByRole("button", { name: locale === "en" ? "Update password" : "Actualizar contraseña", exact: true }).click();
}
for (const locale of ["en", "es"]) {
  const en = locale === "en";
  test(`${locale} guests cannot access settings`, async ({ page }) => {
    await page.goto(`/${locale}/settings`); await expect(page).toHaveURL(new RegExp(`/${locale}$`));
    await expect(page.locator('[name="firstName"]')).toHaveCount(0);
  });
  for (const theme of ["light", "dark"] as const) test(`${locale} ${theme} empty password submission visibly highlights required fields`, async ({ page }) => {
    const email = await account(); await settings(page, email, locale);
    await selectTheme(page, theme);
    const form = passwordForm(page, locale);
    const inputs = form.locator('input[type="password"]');
    const normalBorder = theme === "light" ? "rgb(126, 145, 130)" : "rgb(125, 151, 133)";
    const danger = theme === "light" ? "rgb(138, 49, 49)" : "rgb(242, 170, 170)";
    for (const input of await inputs.all()) await expect(input).toHaveCSS("border-color", normalBorder);
    await form.getByRole("button", { name: en ? "Update password" : "Actualizar contraseña", exact: true }).click();
    await expect(form.getByRole("alert")).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    for (const input of await inputs.all()) {
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toHaveCSS("border-color", danger);
      const errorId = (await input.getAttribute("aria-describedby"))!.split(" ").at(-1)!;
      const error = page.locator(`[id="${errorId}"]`);
      await expect(error).toHaveText(en ? "This field is required." : "Este campo es obligatorio.");
      await expect(error).toHaveCSS("color", danger);
    }
    await fillPassword(page, locale);
    await page.getByRole("dialog").getByRole("button", { name: en ? "Cancel" : "Cancelar", exact: true }).click();
    for (const input of await inputs.all()) {
      await expect(input).not.toHaveAttribute("aria-invalid", "true");
      await expect(input).toHaveCSS("border-color", normalBorder);
    }
    expect((await pool.query("SELECT password_hash FROM users WHERE email=$1", [email])).rows[0].password_hash).toBe(hash);
  });
  test(`${locale} profile saves safely, refreshes name, preserves password draft and supports locale navigation`, async ({ page }) => {
    const email = await account(); await settings(page, email, locale);
    const form = page.getByRole("form", { name: en ? "Profile" : "Perfil", exact: true });
    const emailInput = form.getByLabel(en ? "Email" : "Correo electrónico", { exact: true });
    await expect(emailInput).toHaveValue(email); await expect(emailInput).toHaveAttribute("readonly", "");
    const birthdayInput = form.getByLabel(en ? "Date of birth" : "Fecha de nacimiento", { exact: true });
    await expect(birthdayInput).toHaveValue("1815-12-10");
    await expect(birthdayInput).toHaveAttribute("readonly", "");
    await expect(birthdayInput).toHaveAttribute("type", "date");
    await passwordForm(page, locale).locator('[name="password"]').fill("unsaved draft");
    await form.locator('[name="firstName"]').fill(" Grace "); await form.locator('[name="lastName"]').fill(" Hopper ");
    await form.locator('[name="displayName"]').fill(" Admiral ");
    await form.evaluate((element: HTMLFormElement) => element.addEventListener("formdata", e => {
      for (const name of ["email", "active", "admin", "emailConfirmed", "userId"]) e.formData.set(name, "injected");
      e.formData.set("dateOfBirth", "2000-01-01");
    }));
    await form.getByRole("button", { name: en ? "Save profile" : "Guardar perfil", exact: true }).click();
    await expect(form.getByRole("status")).toContainText(en ? "Profile saved" : "Perfil guardado");
    await expect(page.getByRole("button", { name: "Admiral", exact: true })).toBeVisible();
    await expect(passwordForm(page, locale).locator('[name="password"]')).toHaveValue("unsaved draft");
    await expect(birthdayInput).toHaveValue("1815-12-10");
    expect((await pool.query("SELECT date_of_birth::text AS birthday FROM users WHERE email=$1", [email])).rows[0].birthday).toBe("1815-12-10");
    expect((await pool.query("SELECT first_name,last_name,display_name,email,active,admin,email_confirmed FROM users WHERE email=$1", [email])).rows[0]).toEqual({ first_name: "Grace", last_name: "Hopper", display_name: "Admiral", email, active: true, admin: false, email_confirmed: false });
    await form.locator('[name="displayName"]').fill("");
    await form.getByRole("button", { name: en ? "Save profile" : "Guardar perfil", exact: true }).click();
    await expect(page.getByRole("button", { name: "Grace H.", exact: true })).toBeVisible();
    await page.reload(); await expect(form.locator('[name="firstName"]')).toHaveValue("Grace");
    await page.getByRole("link", { name: en ? "Español" : "English", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${en ? "es" : "en"}/settings$`));
    await page.getByRole("button", { name: "Grace H.", exact: true }).click();
    await page.getByRole("menuitem", { name: en ? "Ajustes" : "Settings", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
  test(`${locale} password confirmation cancels safely and revokes only other browsers on submit`, async ({ page, browser, baseURL }) => {
    const email = await account(); await settings(page, email, locale);
    const other = await browser.newContext({ baseURL });
    try {
      const second = await other.newPage(); await login(second, email, locale);
      await expect(second.getByRole("button", { name: "Ada L.", exact: true })).toBeVisible();
      const currentCookie = (await page.context().cookies()).find(c => c.name === "track_atlas_session")!;
      const form = passwordForm(page, locale);
      await form.locator('[name="password"]').fill("secret"); await form.locator('[name="passwordConfirmation"]').fill("mismatch");
      await form.getByRole("button", { name: en ? "Update password" : "Actualizar contraseña", exact: true }).click();
      await expect(form.getByRole("alert")).toBeVisible(); await expect(page.getByRole("dialog")).toHaveCount(0);
      await fillPassword(page, locale, "cancelled password");
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("button", { name: en ? "Cancel" : "Cancelar", exact: true })).toBeFocused();
      for (let i = 0; i < 5; i++) { await page.keyboard.press("Shift+Tab"); expect(await dialog.evaluate(e => e.contains(document.activeElement))).toBe(true); }
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
      await expect(form.getByRole("button", { name: en ? "Update password" : "Actualizar contraseña", exact: true })).toBeFocused();
      expect((await pool.query("SELECT password_hash FROM users WHERE email=$1", [email])).rows[0].password_hash).toBe(hash);
      await fillPassword(page, locale);
      await dialog.getByRole("button", { name: en ? "Update password" : "Actualizar contraseña", exact: true }).click();
      await expect(dialog).toHaveCount(0); await expect(form.getByRole("status")).toContainText(en ? "Password updated" : "Contraseña actualizada");
      await expect(form.locator('[name="password"]')).toHaveValue(""); await expect(form.locator('[name="passwordConfirmation"]')).toHaveValue("");
      expect((await page.context().cookies()).find(c => c.name === "track_atlas_session")?.value).toBe(currentCookie.value);
      expect((await pool.query("SELECT count(*)::int AS count FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email=$1", [email])).rows[0].count).toBe(1);
      await second.reload(); await expect(second.getByRole("button", { name: en ? "Log in" : "Iniciar sesión", exact: true })).toBeVisible();
      await login(second, email, locale); await expect(second.getByRole("dialog").getByRole("alert")).toBeVisible();
      await second.getByRole("dialog").getByRole("button", { name: en ? "Close" : "Cerrar", exact: true }).click();
      await login(second, email, locale, " new password "); await expect(second.getByRole("button", { name: "Ada L.", exact: true })).toBeVisible();
    } finally { await other.close(); }
  });
  test(`${locale} deactivation requires confirmation, retains the account and signs out every browser`, async ({ page, browser, baseURL }) => {
    const email = await account(); await settings(page, email, locale);
    const other = await browser.newContext({ baseURL });
    try {
      const second = await other.newPage(); await login(second, email, locale); await expect(second.getByRole("button", { name: "Ada L.", exact: true })).toBeVisible();
      const button = page.getByRole("button", { name: en ? "Deactivate account" : "Desactivar cuenta", exact: true });
      await button.click(); const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: en ? "Cancel" : "Cancelar", exact: true }).click();
      await expect(button).toBeFocused(); expect((await pool.query("SELECT active FROM users WHERE email=$1", [email])).rows[0].active).toBe(true);
      await button.click(); await dialog.getByRole("button", { name: en ? "Deactivate account" : "Desactivar cuenta", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}$`));
      expect((await pool.query("SELECT active,email FROM users WHERE email=$1", [email])).rows).toEqual([{ active: false, email }]);
      expect((await pool.query("SELECT count(*)::int AS count FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email=$1", [email])).rows[0].count).toBe(0);
      expect((await page.context().cookies()).find(c => c.name === "track_atlas_session")).toBeUndefined();
      await second.reload(); await expect(second.getByRole("button", { name: en ? "Log in" : "Iniciar sesión", exact: true })).toBeVisible();
      await login(page, email, locale); await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    } finally { await other.close(); }
  });
  for (const theme of ["light", "dark"] as const) test(`${locale} ${theme} mobile settings and shared confirmation fit viewport`, async ({ page }) => {
    const email = await account(); await page.setViewportSize({ width: 375, height: 667 }); await settings(page, email, locale);
    await selectTheme(page, theme); await expectTheme(page, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: en ? "Deactivate account" : "Desactivar cuenta", exact: true }).click();
    const dialog = page.getByRole("dialog"); const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(375); expect(box!.height).toBeLessThanOrEqual(667);
    await expect(dialog).toHaveCSS("background-color", theme === "dark" ? "rgb(29, 48, 38)" : "rgb(255, 255, 255)");
    await page.mouse.click(1, 1); await expect(dialog).toHaveCount(0);
  });
}
test("pending password confirmation cannot dismiss and preserves the submitted snapshot", async ({ page }) => {
  const email = await account(); await settings(page, email);
  await fillPassword(page);
  const gate = Promise.withResolvers<void>();
  await page.route("**/en/settings", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch(); await gate.promise; await route.fulfill({ response });
  });
  const dialog = page.getByRole("dialog");
  try {
    await dialog.getByRole("button", { name: "Update password", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Updating password…", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await page.mouse.click(1, 1); await expect(dialog).toBeVisible();
  } finally { gate.resolve(); }
  await expect(dialog).toHaveCount(0);
  await expect(passwordForm(page).getByRole("status")).toContainText("Password updated");
});
test("expired session while editing cannot save a profile", async ({ page }) => {
  const email = await account(); await settings(page, email);
  await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email=$1)", [email]);
  const form = page.getByRole("form", { name: "Profile", exact: true });
  await form.locator('[name="firstName"]').fill("Not saved"); await form.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("session");
  expect((await pool.query("SELECT first_name FROM users WHERE email=$1", [email])).rows[0].first_name).toBe("Ada");
});
test("password server rejection clears secrets and allows a fresh retry", async ({ page }) => {
  const email = await account(); await settings(page, email); await fillPassword(page);
  const cookie = (await page.context().cookies()).find(c => c.name === "track_atlas_session")!;
  await pool.query("DELETE FROM sessions WHERE token_hash=$1", [createHash("sha256").update(cookie.value).digest("hex")]);
  await page.getByRole("dialog").getByRole("button", { name: "Update password", exact: true }).click();
  await expect(passwordForm(page).getByRole("alert")).toContainText("session");
  await expect(passwordForm(page).locator('[name="password"]')).toHaveValue("");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await pool.query("SELECT password_hash FROM users WHERE email=$1", [email])).rows[0].password_hash).toBe(hash);
});

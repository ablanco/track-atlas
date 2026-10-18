import { test, expect } from "./fixtures";
import { randomUUID, scryptSync } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import type { Page } from "@playwright/test";
import { solveCaptcha } from "./captcha-helpers";
import { waitForCapturedEmail, emailLink } from "./email-helpers";
import { createHmac } from "node:crypto";
loadEnvConfig(process.cwd(), true);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const owned = new Set<string>(), proofs = new Set<string>();
const salt = Buffer.alloc(16, 5), password = "old password";
const hash = `$scrypt$v=1$N=32768,r=8,p=3$${salt.toString("base64url")}$${scryptSync(password, salt, 64, { N:32768,r:8,p:3,maxmem:67108864 }).toString("base64url")}`;
test.describe.configure({ mode: "default" });
test.afterEach(async () => { for (const email of owned) { await pool.query("DELETE FROM users WHERE email=$1", [email]); const key=createHmac("sha256","test-only-private-email-rate-limit-key-2026").update(email.toLowerCase()).digest("hex"); await pool.query("DELETE FROM email_send_limits WHERE key IN ($1,$2)",[`address:password-reset:${key}`,`address:email-confirmation:${key}`]); } for (const proof of proofs) await pool.query("DELETE FROM captcha_uses WHERE challenge_hash=$1", [proof]); owned.clear(); proofs.clear(); });
test.afterAll(() => pool.end());
async function account() { const email = `emails-${randomUUID()}@example.test`; owned.add(email); await pool.query("INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES('Ada','Lovelace',$1,$2,'1815-12-10')",[email,hash]); return email; }
async function login(page: Page, email: string, locale: string, pass = password) {
  await page.goto(`/${locale}`); await page.getByRole("button", { name: locale === "en" ? "Log in" : "Iniciar sesión", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.locator('[name="email"]').fill(email); await dialog.locator('[name="password"]').fill(pass);
  proofs.add(await solveCaptcha(page,dialog)); await dialog.getByRole("button", { name: locale === "en" ? "Log in" : "Iniciar sesión", exact: true }).click();
  await expect(page.getByRole("button",{name:"Ada L.",exact:true})).toBeVisible();
}
for (const locale of ["en","es"]) test(`${locale} opening the confirmation email automatically confirms once and settings reflects its status`, async ({page, browser}) => {
  const en = locale === "en", email = await account(); await login(page,email,locale);
  await page.goto(`/${locale}/settings`);
  await expect(page.getByText(en ? "Not confirmed" : "Sin confirmar",{exact:true})).toBeVisible();
  await page.getByRole("button",{name: en ? "Resend confirmation email" : "Reenviar correo de confirmación",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:en?"Confirmation email requested":"Correo de confirmación solicitado"})).toBeVisible();
  const link = emailLink(await waitForCapturedEmail(email,"email-confirmation"));
  const guest = await browser.newContext(); const confirmation = await guest.newPage();
  // Passive fetching does not mutate during Server Component rendering.
  await confirmation.request.get(link);
  expect((await pool.query("SELECT email_confirmed FROM users WHERE email=$1",[email])).rows[0].email_confirmed).toBe(false);
  let posts=0;
  const gate=Promise.withResolvers<void>();
  await confirmation.route("**/confirm-email?*",async route=>{
    if(route.request().method()==="POST"){posts++;await gate.promise;}
    await route.continue();
  });
  await confirmation.goto(link);
  await expect(confirmation.getByRole("heading",{name:en?"Confirming your email…":"Confirmando tu correo…",exact:true})).toBeVisible();
  await expect(confirmation.getByRole("button",{name:en?"Confirm email":"Confirmar correo",exact:true})).toHaveCount(0);
  gate.resolve();
  await expect(confirmation.getByRole("heading",{name:en?"Email confirmed":"Correo confirmado",exact:true})).toBeVisible();
  expect(posts).toBe(1);
  await expect(confirmation).not.toHaveURL(/token=/);
  await page.reload(); await expect(page.getByText(en?"Confirmed":"Confirmado",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:en?"Resend confirmation email":"Reenviar correo de confirmación",exact:true})).toHaveCount(0);
  await confirmation.goto(link); await expect(confirmation.getByRole("heading",{name:en?"This link is no longer valid":"Este enlace ya no es válido",exact:true})).toBeVisible();
  expect(posts).toBe(1);
  await guest.close();
});
for (const locale of ["en","es"]) test(`${locale} recovery modal sends a single-use reset link and revokes all sessions`, async ({page,browser}) => {
  const en = locale === "en", email = await account(); await login(page,email,locale);
  const guest = await browser.newContext(); const recovery = await guest.newPage(); await recovery.goto(`/${locale}`);
  await recovery.getByRole("button",{name:en?"Log in":"Iniciar sesión",exact:true}).click();
  const dialog = recovery.getByRole("dialog"); await dialog.locator('[name="email"]').fill(email);
  await dialog.locator('[name="password"]').fill("discarded-secret");
  await dialog.getByRole("button",{name:en?"Forgot password?":"¿Has olvidado tu contraseña?",exact:true}).click();
  await expect(dialog.locator('[name="email"]')).toHaveValue(email);
  await dialog.getByRole("button",{name:en?"Back to log in":"Volver al inicio de sesión",exact:true}).click();
  await expect(dialog.locator('[name="email"]')).toBeFocused();
  await expect(dialog.locator('[name="password"]')).toHaveValue("");
  await dialog.getByRole("button",{name:en?"Forgot password?":"¿Has olvidado tu contraseña?",exact:true}).click();
  await dialog.getByRole("button",{name:en?"Send reset link":"Enviar enlace",exact:true}).click();
  await expect(dialog.getByText(en?"If an active account exists for that address, we’ll send a password-reset link.":"Si existe una cuenta activa con esa dirección, te enviaremos un enlace para restablecer la contraseña.",{exact:true})).toBeVisible();
  const link = emailLink(await waitForCapturedEmail(email,"password-reset"));
  const unrelated = await account(); await login(recovery,unrelated,locale);
  await recovery.goto(link);
  await recovery.getByRole("link",{name:en?"Español":"English",exact:true}).click();
  await expect(recovery).toHaveURL(new RegExp(`/${en?"es":"en"}/reset-password\\?token=`));
  await recovery.getByRole("link",{name:en?"English":"Español",exact:true}).click();
  await expect(recovery).toHaveURL(new RegExp(`/${locale}/reset-password\\?token=`));
  await expect(recovery.getByRole("heading", { name: en ? "Choose a new password" : "Elige una nueva contraseña", exact: true })).toBeVisible();
  await recovery.locator('main:visible [name="password"]').fill("new password"); await recovery.locator('main:visible [name="passwordConfirmation"]').fill("different");
  for (const field of ["password", "passwordConfirmation"]) await recovery.locator(`main:visible [name="${field}"]`).locator("..").getByRole("button").click();
  await expect(recovery.locator('main:visible input[type="text"]')).toHaveCount(2);
  await recovery.getByRole("button",{name:en?"Save new password":"Guardar nueva contraseña",exact:true}).click();
  await expect(recovery.locator('main:visible [name="passwordConfirmation"]')).toHaveAttribute("aria-invalid","true");
  await expect(recovery.locator('main:visible [name="password"]')).toHaveValue("");
  await expect(recovery.locator('main:visible [name="passwordConfirmation"]')).toHaveValue("");
  await recovery.locator('main:visible [name="password"]').fill("new password"); await recovery.locator('main:visible [name="passwordConfirmation"]').fill("new password");
  await recovery.getByRole("button",{name:en?"Save new password":"Guardar nueva contraseña",exact:true}).click();
  await expect(recovery.getByRole("heading",{name:en?"Password updated":"Contraseña actualizada",exact:true})).toBeVisible();
  await expect(recovery).not.toHaveURL(/token=/);
  expect((await pool.query("SELECT count(*)::int AS count FROM sessions JOIN users ON users.id=sessions.user_id WHERE users.email=$1",[unrelated])).rows[0].count).toBe(1);
  await page.reload(); await expect(page.getByRole("button",{name:en?"Log in":"Iniciar sesión",exact:true})).toBeVisible();
  await login(page,email,locale,"new password");
  await recovery.goto(link); await expect(recovery.getByRole("heading",{name:en?"This link is no longer valid":"Este enlace ya no es válido",exact:true})).toBeVisible();
  await guest.close();
});

for (const locale of ["en","es"]) for (const theme of ["light","dark"]) test(`${locale} ${theme} recovery fits mobile, hides unknown accounts and resets on close`, async ({page}) => {
  const en=locale==="en"; await page.setViewportSize({width:375,height:812});
  await page.goto(`/${locale}/reset-password?token=${"A".repeat(43)}`);
  await page.getByRole("combobox",{name:en?"Theme":"Tema",exact:true}).selectOption(theme);
  const open = page.getByRole("button",{name:en?"Request a new link":"Solicitar un nuevo enlace",exact:true}); await open.click();
  const dialog=page.getByRole("dialog"); const email=`unknown-${randomUUID()}@example.test`; owned.add(email);
  await expect(dialog.locator('[name="email"]')).toBeFocused(); await dialog.locator('[name="email"]').fill(email);
  await dialog.getByRole("button",{name:en?"Send reset link":"Enviar enlace",exact:true}).click();
  await expect(dialog.getByRole("status")).toContainText(en?"If an active account exists":"Si existe una cuenta activa");
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.keyboard.press("Escape"); await expect(open).toBeFocused(); await open.click();
  await expect(dialog.locator('[name="email"]')).toHaveValue("");
});

for (const locale of ["en","es"]) test(`${locale} signup automatically signs in and captures confirmation without requiring it`, async ({page}) => {
  const email=`signup-emails-${randomUUID()}@example.test`; owned.add(email);
  await page.goto(`/${locale}/signup`);
  await page.locator('[name="firstName"]').fill("Ada"); await page.locator('[name="lastName"]').fill("Lovelace"); await page.locator('[name="email"]').fill(email);
  await page.locator('[name="dateOfBirth"]').fill("1815-12-10"); await page.locator('[name="password"]').fill(password);
  proofs.add(await solveCaptcha(page,page.locator("main")));
  await page.locator('main button[type="submit"]').click(); await expect(page).toHaveURL(new RegExp(`/${locale}$`));
  await expect(page.getByRole("button",{name:"Ada L.",exact:true})).toBeVisible();
  const message=await waitForCapturedEmail(email,"email-confirmation"); expect(emailLink(message)).toContain(`/${locale}/confirm-email?token=`);
  expect((await pool.query("SELECT email_confirmed FROM users WHERE email=$1",[email])).rows[0].email_confirmed).toBe(false);
});

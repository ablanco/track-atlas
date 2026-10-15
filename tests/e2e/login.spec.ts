import { expect, test } from "./fixtures";
import { randomUUID, createHash, scryptSync } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import type { Page } from "@playwright/test";
import { solveCaptcha } from "./captcha-helpers";

loadEnvConfig(process.cwd(), true);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const owned = new Set<string>();
const proofs = new Set<string>();
const salt = Buffer.alloc(16, 7);
const hash = `$scrypt$v=1$N=32768,r=8,p=3$${salt.toString("base64url")}$${scryptSync(" x ", salt, 64, { N: 32768, r: 8, p: 3, maxmem: 67108864 }).toString("base64url")}`;
test.describe.configure({ mode: "default" });
test.afterEach(async () => {
  for (const email of owned) await pool.query("DELETE FROM users WHERE email=$1", [email]);
  for (const digest of proofs) await pool.query("DELETE FROM captcha_uses WHERE challenge_hash=$1", [digest]);
  owned.clear(); proofs.clear();
});
test.afterAll(() => pool.end());
async function account(options: { active?: boolean; passwordHash?: string } = {}) {
  const email = `browser-login-${randomUUID()}@example.test`; owned.add(email);
  await pool.query("INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth,active) VALUES('Ada','Lovelace',$1,$2,'1815-12-10',$3)", [email, options.passwordHash ?? hash, options.active ?? true]);
  return email;
}
async function fillLogin(page: Page, email: string, password = " x ", locale = "en") {
  await page.getByRole("button", { name: locale === "en" ? "Log in" : "Iniciar sesión", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('[name="email"]').fill(email);
  await dialog.locator('[name="password"]').fill(password);
  proofs.add(await solveCaptcha(page, dialog));
  return dialog;
}
const submit = (page: Page, locale = "en") => page.getByRole("dialog").getByRole("button", { name: locale === "en" ? "Log in" : "Iniciar sesión", exact: true }).click();

for (const locale of ["en", "es"]) test(`${locale} header opens accessible login with XIcon and signup link`, async ({ page }) => {
  await page.goto(`/${locale}`);
  await page.getByRole("button", { name: locale === "en" ? "Log in" : "Iniciar sesión", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(locale === "en" ? "Email" : "Correo electrónico", { exact: true })).toBeFocused();
  await expect(dialog.getByLabel(locale === "en" ? "Password" : "Contraseña", { exact: true })).toHaveAttribute("autocomplete", "current-password");
  await expect(dialog.locator("altcha-widget")).toHaveAttribute("challenge", "/api/altcha/login/challenge");
  await expect(dialog.getByRole("link", { name: locale === "en" ? "Create an account" : "Crear una cuenta", exact: true })).toHaveAttribute("href", `/${locale}/signup`);
  const close = dialog.getByRole("button", { name: locale === "en" ? "Close" : "Cerrar", exact: true });
  await expect(close.locator('svg[aria-hidden="true"]')).toBeVisible();
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: locale === "en" ? "Log in" : "Iniciar sesión", exact: true })).toBeFocused();
});

for (const locale of ["en", "es"]) test(`${locale} real login and logout preserve URL and refresh account UI`, async ({ page, baseURL }) => {
  const email = await account();
  const path = `/${locale}?source=login-test#open-source`;
  await page.goto(path);
  await fillLogin(page, email.toUpperCase(), " x ", locale);
  await page.evaluate(() => window.scrollTo(0, 350));
  const scroll = await page.evaluate(() => window.scrollY);
  await submit(page, locale);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const logout = page.getByRole("button", { name: locale === "en" ? "Log out" : "Cerrar sesión", exact: true });
  await expect(logout).toBeVisible();
  expect(page.url()).toBe(new URL(path, baseURL).href);
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  await expect(page.getByRole("main").getByRole("link", { name: locale === "en" ? "Create account" : "Crear cuenta", exact: true })).toHaveCount(0);
  const cookie = (await page.context().cookies()).find((c) => c.name === "track_atlas_session")!;
  expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe("Lax"); expect(cookie.path).toBe("/");
  expect(await page.evaluate(() => document.cookie)).not.toContain("track_atlas_session");
  const digest = createHash("sha256").update(cookie.value).digest("hex");
  expect((await pool.query("SELECT count(*)::int AS count FROM sessions WHERE token_hash=$1", [digest])).rows[0].count).toBe(1);
  await logout.click();
  await expect(page.getByRole("button", { name: locale === "en" ? "Log in" : "Iniciar sesión", exact: true })).toBeVisible();
  expect(page.url()).toBe(new URL(path, baseURL).href);
  await expect(page.getByRole("main").getByRole("link", { name: locale === "en" ? "Create account" : "Crear cuenta", exact: true })).toBeVisible();
  expect((await page.context().cookies()).find((c) => c.name === "track_atlas_session")).toBeUndefined();
  expect((await pool.query("SELECT count(*)::int AS count FROM sessions WHERE token_hash=$1", [digest])).rows[0].count).toBe(0);
});

for (const kind of ["wrong", "unknown", "inactive", "bad-hash"]) test(`${kind} credentials show generic error, clear password, and reset proof`, async ({ page }) => {
  const email = kind === "unknown" ? `unknown-${randomUUID()}@example.test` : await account(kind === "inactive" ? { active: false } : kind === "bad-hash" ? { passwordHash: "synthetic" } : {});
  await page.goto("/en");
  const dialog = await fillLogin(page, email, kind === "wrong" ? "wrong" : " x ");
  await submit(page);
  await expect(dialog.getByRole("alert")).toHaveText("The email or password is incorrect.");
  await expect(dialog.getByRole("alert")).toBeFocused();
  await expect(dialog.locator('[name="email"]')).toHaveValue(email);
  await expect(dialog.locator('[name="password"]')).toHaveValue("");
  await expect(dialog.locator('input[name="altcha"]')).toHaveValue("");
  expect((await page.context().cookies()).find((c) => c.name === "track_atlas_session")).toBeUndefined();
});

test("login/logout from signup keeps signup route and toggles authenticated notice", async ({ page }) => {
  const email = await account();
  await page.goto("/en/signup?from=modal#main-content");
  await fillLogin(page, email);
  await submit(page);
  await expect(page.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
  await expect(page.getByRole("main").locator("form")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("status")).toContainText("already signed in");
  expect(new URL(page.url()).pathname).toBe("/en/signup");
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("main").locator("form")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/en/signup");
});

test("escape, backdrop and signup link dismiss; reopening discards password and proof", async ({ page }) => {
  await page.goto("/en");
  const trigger = page.getByRole("button", { name: "Log in", exact: true });
  await trigger.click();
  await page.getByRole("dialog").locator('[name="password"]').fill("private");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByRole("dialog").locator('[name="password"]')).toHaveValue("");
  await page.mouse.click(2, 2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("dialog").getByRole("link", { name: "Create an account", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/signup$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("modal contains keyboard focus and fits mobile dark theme", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/en");
  await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(375); expect(box!.height).toBeLessThanOrEqual(667);
  await expect(dialog).toHaveCSS("background-color", "rgb(29, 48, 38)");
  expect(await dialog.evaluate((element) => getComputedStyle(element, "::backdrop").backgroundColor)).toBe("rgba(15, 27, 21, 0.55)");
  for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true); }
});

for (const kind of ["missing-proof", "malformed-proof", "duplicate-email", "file-password", "oversized-password"]) test(`login action rejects tampered ${kind}`, async ({ page }) => {
  const email = await account();
  await page.goto("/en");
  const dialog = await fillLogin(page, email);
  await dialog.locator("form").evaluate((element: HTMLFormElement, kind) => {
    element.noValidate = true;
    element.addEventListener("formdata", (event) => {
      if (kind === "missing-proof") event.formData.delete("altcha");
      if (kind === "malformed-proof") event.formData.set("altcha", "bad");
      if (kind === "duplicate-email") event.formData.append("email", "another@example.test");
      if (kind === "file-password") event.formData.set("password", new File(["private"], "private.txt"));
      if (kind === "oversized-password") event.formData.set("password", "💚".repeat(257));
    });
  }, kind);
  await submit(page);
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect((await pool.query("SELECT count(*)::int AS count FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email=$1", [email])).rows[0].count).toBe(0);
});

test("pending login cannot dismiss and replay cannot issue another session", async ({ page, baseURL }) => {
  const email = await account();
  await page.goto("/en?pending=1");
  const dialog = await fillLogin(page, email);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/en?pending=1", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch(); await gate; await route.fulfill({ response });
  });
  const captured = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await submit(page);
  const request = await captured;
  await expect(dialog.getByRole("button", { name: "Logging in…", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Create an account", exact: true })).toHaveAttribute("aria-disabled", "true");
  await dialog.getByRole("link", { name: "Create an account", exact: true }).dispatchEvent("click");
  expect(new URL(page.url()).pathname).toBe("/en");
  await page.keyboard.press("Escape"); await page.mouse.click(2, 2); await expect(dialog).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
  await page.unroute("**/en?pending=1");
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  const headers = request.headers();
  const replay = await page.request.post("/en?pending=1", { headers: { "next-action": headers["next-action"], "content-type": headers["content-type"], origin: new URL(baseURL!).origin }, data: request.postDataBuffer()! });
  expect(await replay.text()).toContain('"formError":"captcha"');
  expect(replay.headers()["set-cookie"] ?? "").not.toContain("track_atlas_session");
  expect((await pool.query("SELECT count(*)::int AS count FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email=$1", [email])).rows[0].count).toBe(0);
});

test("stale cookies permit login and logout does not sign out another browser", async ({ page, browser, baseURL }) => {
  const email = await account();
  await page.context().addCookies([{ name: "track_atlas_session", value: "A".repeat(43), url: baseURL! }]);
  await page.goto("/en"); await fillLogin(page, email); await submit(page);
  await expect(page.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
  const other = await browser.newContext({ baseURL });
  try {
    const second = await other.newPage(); await second.goto("/en"); await fillLogin(second, email); await submit(second);
    await expect(second.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
    await second.reload(); await expect(second.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
  } finally { await other.close(); }
});

test("login challenge endpoint is no-store and purpose-bound", async ({ request }) => {
  const response = await request.get("/api/altcha/login/challenge");
  expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toContain("no-store");
  const challenge = await response.json(); expect(challenge.parameters.data.purpose).toBe("login");
});

test("login is not offered as interactive before hydration", async ({ request }) => {
  const html = await (await request.get("/en")).text();
  const trigger = html.match(/<button[^>]*aria-haspopup="dialog"[^>]*>/)?.[0];
  expect(trigger).toBeDefined();
  expect(trigger).toContain('disabled=""');
});

test("login verification outage cannot create a session", async ({ page }) => {
  const email = await account();
  await page.route("**/api/altcha/login/challenge", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Verification is temporarily unavailable" }) }));
  await page.goto("/en");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('[name="email"]').fill(email); await dialog.locator('[name="password"]').fill(" x ");
  await dialog.locator("altcha-widget").getByRole("checkbox").click();
  await expect(dialog.locator("altcha-widget")).toContainText(/error|failed|unable/i);
  await expect(dialog.locator('input[name="altcha"]')).toHaveValue("");
  await dialog.locator("form").evaluate((form: HTMLFormElement) => { form.noValidate = true; });
  await submit(page);
  await expect(dialog.getByRole("alert")).toContainText("verification");
  expect((await pool.query("SELECT count(*)::int AS count FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email=$1", [email])).rows[0].count).toBe(0);
});

test("locale navigation does not reopen a dismissed login modal", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("dialog").locator('[name="password"]').fill("discard-me");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Español", exact: true }).click();
  await expect(page).toHaveURL(/\/es$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page.getByRole("dialog").locator('[name="password"]')).toHaveValue("");
  await page.keyboard.press("Escape"); await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

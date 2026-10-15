import { randomUUID, createHash, scryptSync } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

loadEnvConfig(process.cwd(), true);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ownedEmails = new Set<string>();
test.describe.configure({ mode: "default" });
test.afterEach(async () => {
  for (const email of ownedEmails) await pool.query("DELETE FROM users WHERE lower(email)=lower($1)", [email]);
  ownedEmails.clear();
});
test.afterAll(() => pool.end());
function email() { const value = `browser-signup-${randomUUID()}@example.test`; ownedEmails.add(value); return value; }
async function fill(page: Page, address: string, password = "x") {
  await page.locator('[name="firstName"]').fill("Ada");
  await page.locator('[name="lastName"]').fill("Lovelace");
  await page.locator('[name="email"]').fill(address);
  await page.locator('[name="dateOfBirth"]').fill("1815-12-10");
  await page.locator('[name="password"]').fill(password);
}

for (const locale of ["en", "es"]) for (const theme of ["light", "dark"] as const) for (const width of [375, 1440]) {
  test(`${locale} ${theme} ${width}: signup layout and accessible fields`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`/${locale}`);
    await page.getByRole("link", { name: locale === "en" ? "Create account" : "Crear cuenta", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/signup$`));
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(locale === "en" ? "Create your account" : "Crea tu cuenta");
    for (const name of ["firstName", "lastName", "email", "dateOfBirth", "password"]) {
      const field = page.locator(`[name="${name}"]`);
      await expect(field).toBeVisible();
      await expect(field).toHaveAttribute("required", "");
      await expect(page.locator(`label[for="${name}"]`)).toContainText("*");
    }
    await expect(page.locator('[name="displayName"]')).not.toHaveAttribute("required");
    await expect(page.locator('[name="password"]')).toHaveAttribute("autocomplete", "new-password");
    await expect(page.locator('[name="password"]')).not.toHaveAttribute("minlength");
    await expect(page.locator('[name="avatarUrl"], [name="confirmPassword"], iframe')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const first = await page.locator('[name="firstName"]').boundingBox();
    const last = await page.locator('[name="lastName"]').boundingBox();
    expect(first && last && (width === 375 ? last.y > first.y : last.y === first.y)).toBe(true);
    // A fresh document starts keyboard traversal at the skip link; client-side
    // navigation intentionally moves focus into the destination main content.
    await page.goto(`/${locale}/signup`);
    await page.keyboard.press("Tab");
    await expect(page.locator('a[href="#main-content"]')).toBeFocused();
  });
}
test("signup language navigation preserves path; homepage section links resolve", async ({ page }) => {
  await page.goto("/en/signup");
  await page.getByRole("link", { name: "Español", exact: true }).click();
  await expect(page).toHaveURL(/\/es\/signup$/);
  await page.getByRole("link", { name: "Descubre", exact: true }).click();
  await expect(page).toHaveURL(/\/es#discover$/);
});

for (const locale of ["en", "es"]) test(`${locale} signup logs in, isolates browser state, and rejects replayed guest action`, async ({ page, browser, baseURL }) => {
  const address = email();
  await page.goto(`/${locale}/signup`);
  await fill(page, address, " x ");
  if (locale === "es") await page.locator('[name="displayName"]').fill("Countess");
  const requestPromise = page.waitForRequest((request) => request.method() === "POST" && !!request.headers()["next-action"]);
  await page.getByRole("button", { name: locale === "en" ? "Create account" : "Crear cuenta", exact: true }).click();
  const captured = await requestPromise;
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
  const cookie = (await page.context().cookies()).find((item) => item.name === "track_atlas_session");
  expect(cookie).toBeDefined();
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  expect(cookie?.path).toBe("/");
  const { rows: [user] } = await pool.query("SELECT * FROM users WHERE email=$1", [address]);
  expect(user.display_name).toBe(locale === "es" ? "Countess" : null);
  expect(user.avatar_url).toBe(null);
  expect(user.active).toBe(true);
  const parts = user.password_hash.split("$");
  expect(scryptSync(" x ", Buffer.from(parts[4], "base64url"), 64, { N: 32768, r: 8, p: 3, maxmem: 67108864 }).toString("base64url")).toBe(parts[5]);
  const { rows: [session] } = await pool.query("SELECT * FROM sessions WHERE user_id=$1", [user.id]);
  expect(session.token_hash).toBe(createHash("sha256").update(cookie!.value).digest("hex"));
  expect(Math.abs(session.expires_at.getTime() / 1000 - cookie!.expires)).toBeLessThan(1);
  expect(await page.evaluate(() => document.cookie)).not.toContain("track_atlas_session");
  await page.reload();
  await expect(page.getByRole("link", { name: locale === "en" ? "Create account" : "Crear cuenta", exact: true })).toHaveCount(0);
  const other = await browser.newContext({ baseURL });
  try {
    const guest = await other.newPage();
    await guest.goto(`/${locale}`);
    await expect(guest.getByRole("link", { name: locale === "en" ? "Create account" : "Crear cuenta", exact: true })).toBeVisible();
    await guest.goto(`/${locale}/signup`);
    await expect(guest.locator("form")).toBeVisible();
  } finally { await other.close(); }
  await page.goto(`/${locale}/signup`);
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
  await page.goBack();
  await expect(page.locator("form")).toHaveCount(0);
  const headers = captured.headers();
  const replay = await page.request.post(`/${locale}/signup`, { headers: { "next-action": headers["next-action"], "content-type": headers["content-type"], origin: new URL(baseURL!).origin }, data: captured.postDataBuffer()!, maxRedirects: 0 });
  expect(replay.headers()["x-action-redirect"]).toContain(`/${locale}`);
  const crossOrigin = await page.request.post(`/${locale}/signup`, { headers: { "next-action": headers["next-action"], "content-type": headers["content-type"], origin: "https://untrusted.example" }, data: captured.postDataBuffer()!, maxRedirects: 0 });
  expect(crossOrigin.status()).toBeGreaterThanOrEqual(400);
  expect((await pool.query("SELECT count(*)::int AS count FROM sessions WHERE user_id=$1", [user.id])).rows[0].count).toBe(1);
  await pool.query("UPDATE users SET active=false WHERE id=$1", [user.id]);
  await page.goto(`/${locale}/signup`);
  await expect(page.locator("form")).toBeVisible();
});

for (const [field, kind] of [["firstName", "missing"], ["email", "repeat"], ["displayName", "file"], ["dateOfBirth", "impossible"], ["email", "invalid"]] as const) test(`server rejects ${kind} ${field} through actual action`, async ({ page }) => {
  const address = email();
  await page.goto("/en/signup");
  await fill(page, address);
  await page.locator("form").evaluate((form: HTMLFormElement, { field, kind }) => {
    form.noValidate = true;
    form.addEventListener("formdata", (event) => {
      if (kind === "missing") event.formData.delete(field);
      if (kind === "repeat") event.formData.append(field, "second@example.test");
      if (kind === "file") event.formData.set(field, new File(["not text"], "field.txt"));
      if (kind === "impossible") event.formData.set(field, "2026-02-30");
      if (kind === "invalid") event.formData.set(field, "invalid-email");
    });
  }, { field, kind });
  // Read through the intercepted API response: Chromium can discard a streamed
  // RSC response body before Network.getResponseBody runs in development.
  let responseBody = "";
  await page.route("**/en/signup", async (route) => {
    if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    const response = await route.fetch();
    responseBody = await response.text();
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.locator(`[name="${field}"]`)).toHaveAttribute("aria-invalid", "true");
  expect((await pool.query("SELECT count(*)::int AS count FROM users WHERE email=$1", [address])).rows[0].count).toBe(0);
  expect(responseBody).not.toBe("");
  expect(responseBody).not.toContain('"password":"x"');
  expect(responseBody).not.toContain("$scrypt$");
  expect((await page.context().cookies()).find((cookie) => cookie.name === "track_atlas_session")).toBeUndefined();
});

test("pending submission disables submit and announces progress; expired sessions permit signup", async ({ page }) => {
  const address = email();
  await pool.query("INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES('Expiry','Fixture',$1,'original','2000-01-01')", [address]);
  const token = Buffer.alloc(32, 7).toString("base64url");
  await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) SELECT id,$2,statement_timestamp()-interval '1 second' FROM users WHERE email=$1", [address, createHash("sha256").update(token).digest("hex")]);
  await page.context().addCookies([{ name: "track_atlas_session", value: token, url: test.info().project.use.baseURL as string }]);
  await page.goto("/en/signup");
  await fill(page, email());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/en/signup", async (route) => { if (route.request().method() === "POST") await gate; await route.continue(); });
  try {
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("button", { name: "Creating account…", exact: true })).toBeDisabled();
    await expect(page.locator("form").getByRole("status")).toHaveText("Creating account…");
  } finally { release(); }
  await expect(page).toHaveURL(/\/en$/);
});

test("server validation bypass preserves safe values, clears password and announces errors", async ({ page }) => {
  await page.goto("/en/signup");
  await fill(page, email(), "é".repeat(513));
  await page.locator("form").evaluate((form: HTMLFormElement) => { form.noValidate = true; });
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.locator('[name="password"]')).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator('[name="password"]')).toHaveValue("");
  await expect(page.locator('[name="firstName"]')).toHaveValue("Ada");
  await expect(page.locator("form").getByRole("alert")).toContainText("check");
  expect((await page.context().cookies()).find((cookie) => cookie.name === "track_atlas_session")).toBeUndefined();
});

test("duplicate email gives a field error and stale cookies are replaced on successful signup", async ({ page }) => {
  const address = email();
  await pool.query("INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth,active) VALUES('Existing','User',$1,'original','2000-01-01',false)", [address]);
  await page.context().addCookies([{ name: "track_atlas_session", value: "stale", url: new URL(page.url() === "about:blank" ? (test.info().project.use.baseURL as string) : page.url()).origin }]);
  await page.goto("/en/signup");
  await fill(page, address.toUpperCase());
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.locator('[name="email"]')).toHaveAttribute("aria-invalid", "true");
  expect((await page.context().cookies()).find((cookie) => cookie.name === "track_atlas_session")?.value).toBe("stale");
  await fill(page, email());
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/en$/);
  expect((await page.context().cookies()).find((cookie) => cookie.name === "track_atlas_session")?.value).not.toBe("stale");
});

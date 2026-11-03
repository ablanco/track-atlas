import { randomUUID, scryptSync, createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { expect, test, selectTheme, selectLanguage } from "./fixtures";
import { solveCaptcha } from "./captcha-helpers";
loadEnvConfig(process.cwd(), true);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const accounts = new Set<string>();
const proofs = new Set<string>();
const salt = Buffer.alloc(16, 19);
const passwordHash = `$scrypt$v=1$N=32768,r=8,p=3$${salt.toString("base64url")}$${scryptSync("legal password", salt, 64, { N: 32768, r: 8, p: 3, maxmem: 67108864 }).toString("base64url")}`;
test.afterEach(async () => {
  for (const email of accounts)
    await pool.query("DELETE FROM users WHERE email=$1", [email]);
  for (const proof of proofs)
    await pool.query("DELETE FROM captcha_uses WHERE challenge_hash=$1", [
      proof,
    ]);
  accounts.clear();
  proofs.clear();
});
test.afterAll(() => pool.end());
for (const locale of ["en", "es"])
  test(`${locale} existing account signs in through real ALTCHA and renews unchecked documents`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const email = `legal-gate-${randomUUID()}@example.test`;
    accounts.add(email);
    await pool.query(
      "INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES('Legal','Tester',$1,$2,'1990-01-01')",
      [email, passwordHash],
    );
    await page.goto(`/${locale}`);
    await page
      .getByRole("button", {
        name: locale === "en" ? "Log in" : "Iniciar sesión",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('[name="email"]').fill(email);
    await dialog.locator('[name="password"]').fill("legal password");
    proofs.add(await solveCaptcha(page, dialog));
    await dialog
      .getByRole("button", {
        name: locale === "en" ? "Log in" : "Iniciar sesión",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/accept-legal`));
    await expect(
      page.locator('[name="termsAccepted"]:visible'),
    ).not.toBeChecked();
    await expect(
      page.locator('[name="privacyAcknowledged"]:visible'),
    ).not.toBeChecked();
    await selectTheme(page, "dark");
    const api = await page.request.get("/api/lists");
    expect(api.status()).toBe(401);
    const publicApi = await page.request.get("/api/tracks/explore");
    expect(publicApi.status()).toBe(401);
    // Intended destination survives the language control, and legal pages remain available.
    await page.goto(`/${locale}/settings`);
    await expect(page).toHaveURL(/accept-legal.*returnTo=/);
    await selectLanguage(page, locale === "en" ? "Español" : "English");
    const language = locale === "en" ? "es" : "en";
    await expect(page).toHaveURL(
      new RegExp(`/${language}/accept-legal.*returnTo=`),
    );
    await expect(
      page.locator('[name="termsAccepted"]:visible'),
    ).not.toBeChecked();
    await page.locator('[name="termsAccepted"]:visible').check();
    await page.locator('[name="privacyAcknowledged"]:visible').check();
    await page
      .getByRole("button", {
        name: language === "en" ? "Accept and continue" : "Aceptar y continuar",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(`/${locale}/settings`);
    const evidence = await pool.query(
      "SELECT terms_version,privacy_version,locale,accepted_at FROM legal_acceptances WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      [email],
    );
    expect(evidence.rows).toHaveLength(1);
    expect(evidence.rows[0].locale).toBe(language);
    expect(evidence.rows[0].accepted_at).toBeInstanceOf(Date);
  });

test("active pending session can read legal history and logout", async ({
  page,
  context,
  baseURL,
}) => {
  const email = `legal-active-${randomUUID()}@example.test`;
  accounts.add(email);
  const token = Buffer.alloc(32, 27).toString("base64url");
  const result = await pool.query(
    "INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES('Legal','Tester',$1,$2,'1990-01-01') RETURNING id",
    [email, passwordHash],
  );
  const id = result.rows[0].id;
  await pool.query(
    "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
    [id, createHash("sha256").update(token).digest("hex")],
  );
  await context.addCookies([
    {
      name: "track_atlas_session",
      value: token,
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/en/legal/privacy/2026-11-03");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/en/accept-legal?returnTo=https://evil.test");
  await selectTheme(page, "light");
  // Header retains the valid session instead of presenting guest login controls.
  await page.getByRole("button", { name: /Legal T/ }).click();
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Log in", exact: true }),
  ).toBeVisible();
  expect(
    (await pool.query("SELECT id FROM sessions WHERE user_id=$1", [id]))
      .rowCount,
  ).toBe(0);
});

test("a settings action rendered before acceptance became stale reauthorizes the session", async ({
  page,
  context,
  baseURL,
}) => {
  const { acceptFixtureDocuments } = await import("../helpers/legal-evidence");
  const email = `legal-stale-action-${randomUUID()}@example.test`;
  accounts.add(email);
  const token = Buffer.alloc(32, 28).toString("base64url");
  const result = await pool.query(
    "INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES('Legal','Tester',$1,$2,'1990-01-01') RETURNING id",
    [email, passwordHash],
  );
  const id = result.rows[0].id;
  await acceptFixtureDocuments(pool, id);
  await pool.query(
    "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
    [id, createHash("sha256").update(token).digest("hex")],
  );
  await context.addCookies([
    {
      name: "track_atlas_session",
      value: token,
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/en/settings");
  await page.locator('[name="firstName"]:visible').fill("Forbidden");
  // Simulate a missing generation after this form was delivered. No production
  // API can delete immutable evidence; this is fixture state at the HTTP seam.
  await pool.query("DELETE FROM legal_acceptances WHERE user_id=$1", [id]);
  const form = page
    .locator("form")
    .filter({ has: page.locator('[name="firstName"]:visible') });
  await form.getByRole("button", { name: /Save profile/i }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  expect(
    (await pool.query("SELECT first_name FROM users WHERE id=$1", [id])).rows[0]
      .first_name,
  ).toBe("Legal");
  await page.reload();
  await expect(page).toHaveURL(/accept-legal/);
});

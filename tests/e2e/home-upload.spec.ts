import { test, expect } from "./fixtures";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { randomUUID, scryptSync } from "node:crypto";
import { solveCaptcha } from "./captcha-helpers";
import { waitForCapturedEmail, emailLink } from "./email-helpers";
loadEnvConfig(process.cwd(), true);
test.describe.configure({ mode: "default" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const emails = new Set<string>(),
  proofs = new Set<string>();
test.afterEach(async () => {
  for (const email of emails)
    await pool.query("DELETE FROM users WHERE email=$1", [email]);
  for (const proof of proofs)
    await pool.query("DELETE FROM captcha_uses WHERE challenge_hash=$1", [
      proof,
    ]);
  emails.clear();
  proofs.clear();
});
test.afterAll(() => pool.end());
for (const locale of ["en", "es"]) {
  test(`${locale} homepage upload continues through signup and email confirmation`, async ({
    page,
  }) => {
    const email = `homepage-${randomUUID()}@example.test`;
    emails.add(email);
    await page.goto(`/${locale}`);
    await page
      .getByRole("main")
      .locator(`a[href='/${locale}/tracks/upload?login=1']`)
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator(`a[href='/${locale}/signup?intent=upload']`).click();
    await expect(page).toHaveURL(
      new RegExp(`/${locale}/signup\\?intent=upload$`),
    );
    await page.locator('[name="firstName"]').fill("Ada");
    await page.locator('[name="lastName"]').fill("Lovelace");
    await page.locator('[name="email"]').fill(email);
    await page.locator('[name="dateOfBirth"]').fill("1815-12-10");
    await page.locator('[name="password"]').fill("homepage password");
    proofs.add(await solveCaptcha(page));
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/tracks/upload$`));
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name:
          locale === "en"
            ? "Resend confirmation email"
            : "Reenviar correo de confirmación",
      }),
    ).toBeVisible();
    const intent = (await page.context().cookies()).find(
      (c) => c.name === "track_atlas_upload_intent",
    );
    expect(intent?.httpOnly).toBe(true);
    expect(intent?.value).toBe("upload");
    const message = await waitForCapturedEmail(email, "email-confirmation");
    const link = emailLink(message);
    await page.goto(link);
    const continueLink = page.getByRole("link", {
      name:
        locale === "en"
          ? "Continue to upload"
          : "Continuar para subir un track",
      exact: true,
    });
    await expect(continueLink).toBeVisible();
    await continueLink.click();
    await expect(page.locator('input[type="file"]')).toBeVisible();
    await page.goto(link);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      locale === "en"
        ? "This link is no longer valid"
        : "Este enlace ya no es válido",
    );
    expect(
      (
        await pool.query("SELECT email_confirmed FROM users WHERE email=$1", [
          email,
        ])
      ).rows[0].email_confirmed,
    ).toBe(true);
  });
  test(`${locale} existing confirmed account logs in from Upload and reaches the form`, async ({
    page,
  }) => {
    const email = `homepage-login-${randomUUID()}@example.test`;
    emails.add(email);
    const salt = Buffer.alloc(16, 7);
    const hash = `$scrypt$v=1$N=32768,r=8,p=3$${salt.toString("base64url")}$${scryptSync("homepage password", salt, 64, { N: 32768, r: 8, p: 3, maxmem: 67108864 }).toString("base64url")}`;
    await pool.query(
      "INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth,email_confirmed) VALUES('Ada','Lovelace',$1,$2,'1815-12-10',true)",
      [email, hash],
    );
    await page.goto(`/${locale}/tracks/upload?login=1`);
    const dialog = page.getByRole("dialog");
    await dialog.locator('[name="email"]').fill(email);
    await dialog.locator('[name="password"]').fill("homepage password");
    proofs.add(await solveCaptcha(page, dialog));
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`/${locale}/tracks/upload\\?login=1$`),
    );
  });
}
test("signup intent rejects external destinations and survives locale navigation", async ({
  page,
}) => {
  await page.goto("/en/signup?intent=https://example.invalid");
  await expect(
    page.getByRole("main").locator('input[name="intent"]'),
  ).toHaveCount(0);
  await page.goto("/en/signup?intent=upload");
  await page.getByRole("link", { name: "Español", exact: true }).click();
  await expect(page).toHaveURL(/\/es\/signup\?intent=upload$/);
  await expect(
    page.getByRole("main").locator('input[name="intent"]'),
  ).toHaveValue("upload");
});

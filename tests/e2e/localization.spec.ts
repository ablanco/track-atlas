import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { locales } from "../../i18n/locales";
import { test, expect, selectLanguage, expectTheme } from "./fixtures";
import { solveCaptcha } from "./captcha-helpers";
import { waitForCapturedEmail, emailLink } from "./email-helpers";

loadEnvConfig(process.cwd(), true);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
test.afterAll(() => pool.end());

for (const locale of locales) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme}: localized navigation, signup links and theme survive language switching`, async ({
      page,
    }) => {
      const messages = JSON.parse(
        await readFile(`messages/${locale}.json`, "utf8"),
      );
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 375, height: 900 });
      await page.goto(`/${locale}`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        messages.Home.title,
      );
      await expectTheme(page, theme);
      await page.goto(`/${locale}/signup?intent=upload`);
      await expect(page.locator('[name="dateOfBirth"]')).toHaveAttribute(
        "placeholder",
        messages.Signup.birthdayFormat,
      );
      for (const name of ["termsAccepted", "privacyAcknowledged"]) {
        await expect(page.locator(`label[for="${name}"] a`)).toHaveText(/\S+/);
      }
      // The selector uses endonyms and preserves the current route and query.
      await selectLanguage(page, locale === "fr" ? "Italiano" : "Français");
      await expect(page).toHaveURL(
        new RegExp(`/${locale === "fr" ? "it" : "fr"}/signup\\?intent=upload$`),
      );
      await expectTheme(page, theme);
    });
  }
}

for (const locale of ["fr", "pt", "de", "it"] as const) {
  test(`${locale}: real CAPTCHA and signup record the language of legal acceptance`, async ({
    page,
  }) => {
    const email = `locale-signup-${randomUUID()}@example.test`;
    let proof: string | undefined;
    try {
      await page.goto(`/${locale}/signup`);
      await page.locator('[name="firstName"]').fill("Ada");
      await page.locator('[name="lastName"]').fill("Lovelace");
      await page.locator('[name="email"]').fill(email);
      await page.locator('[name="dateOfBirth"]').fill("10/12/1815");
      await page.locator('[name="password"]').fill("test-locale-password");
      await page.locator('[name="termsAccepted"]').check();
      await page.locator('[name="privacyAcknowledged"]').check();
      const checkbox = page.locator("altcha-widget").getByRole("checkbox");
      await expect(checkbox).not.toHaveAccessibleName(/I'm not a robot/);
      proof = await solveCaptcha(page);
      await page.locator('form button[type="submit"]').click();
      await expect(page).toHaveURL(new RegExp(`/${locale}$`));
      const result = await pool.query(
        "SELECT u.date_of_birth::text AS birthday, a.locale FROM users u JOIN legal_acceptances a ON a.user_id=u.id WHERE u.email=$1",
        [email],
      );
      expect(result.rows).toEqual([{ birthday: "1815-12-10", locale }]);
      const message = await waitForCapturedEmail(email, "email-confirmation");
      expect(new URL(emailLink(message)).pathname).toBe(
        `/${locale}/confirm-email`,
      );
      const messages = JSON.parse(
        await readFile(`messages/${locale}.json`, "utf8"),
      );
      expect(message.subject).toBe(messages.AccountEmails.confirmation.subject);
    } finally {
      await pool.query("DELETE FROM users WHERE email=$1", [email]);
      if (proof)
        await pool.query("DELETE FROM captcha_uses WHERE challenge_hash=$1", [
          proof,
        ]);
    }
  });
}

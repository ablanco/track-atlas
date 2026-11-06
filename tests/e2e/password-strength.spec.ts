import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { expect, test, selectTheme, expectColor } from "./fixtures";
import { solveCaptcha } from "./captcha-helpers";
import { formatBirthday } from "../../auth/birthday-format";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import pt from "../../messages/pt.json";
import de from "../../messages/de.json";
import it from "../../messages/it.json";

loadEnvConfig(process.cwd(), true);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
test.afterAll(() => pool.end());
const strong = "violet otter brass lantern";
const catalogs = { en, es, fr, pt, de, it };

for (const locale of Object.keys(catalogs) as (keyof typeof catalogs)[])
  for (const theme of ["light", "dark"] as const)
    test(`${locale} ${theme}: meter updates and rejects weak passwords locally`, async ({
      page,
    }) => {
      const messages = catalogs[locale];
      await page.setViewportSize({ width: 375, height: 1000 });
      await page.goto(`/${locale}/signup`);
      await selectTheme(page, theme);
      const meter = page.getByRole("progressbar", {
        name: messages.PasswordStrength.label,
      });
      await expect(meter).toHaveAttribute(
        "aria-valuetext",
        messages.PasswordStrength.empty,
      );
      await page.locator('[name="firstName"]').fill("Ada");
      await page.locator('[name="lastName"]').fill("Lovelace");
      await page
        .locator('[name="email"]')
        .fill(`strength-${randomUUID()}@example.test`);
      await page
        .locator('[name="dateOfBirth"]')
        .fill(formatBirthday("1815-12-10", locale));
      await page.locator('[name="termsAccepted"]').check();
      await page.locator('[name="privacyAcknowledged"]').check();
      await solveCaptcha(page);
      const password = page.locator('[name="password"]');
      await password.fill(strong);
      await expect(meter).toHaveAttribute(
        "aria-valuetext",
        messages.PasswordStrength.scores["4"],
      );
      await expectColor(
        meter.locator('[data-slot="progress-indicator"]'),
        "background-color",
        await page
          .locator("html")
          .evaluate((element) =>
            getComputedStyle(element).getPropertyValue("--success"),
          ),
      );
      if (locale === "en" && theme === "light") {
        await password.fill("é".repeat(513));
        await expect(meter).toHaveAttribute(
          "aria-valuetext",
          messages.PasswordStrength.tooLong,
        );
      }
      await password.fill("P@ssw0rd!");
      await expect(meter).toHaveAttribute(
        "aria-valuetext",
        messages.PasswordStrength.scores["1"],
      );
      await expectColor(
        meter.locator('[data-slot="progress-indicator"]'),
        "background-color",
        await page
          .locator("html")
          .evaluate((element) =>
            getComputedStyle(element).getPropertyValue("--destructive"),
          ),
      );
      let submissions = 0;
      page.on("request", (request) => {
        if (request.method() === "POST" && request.headers()["next-action"])
          submissions++;
      });
      await page.locator('form button[type="submit"]').click();
      await expect(page.locator("#password-error")).toHaveText(
        messages.Signup.errors.weak,
      );
      await expect(password).toHaveValue("");
      await expect(meter).toHaveAttribute(
        "aria-valuetext",
        messages.PasswordStrength.empty,
      );
      expect(submissions).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });

test("server rejects a weak password substituted after browser validation", async ({
  page,
}) => {
  const email = `strength-server-${randomUUID()}@example.test`;
  try {
    await page.goto("/en/signup");
    for (const [name, value] of Object.entries({
      firstName: "Ada",
      lastName: "Lovelace",
      email,
      dateOfBirth: "12/10/1815",
      password: strong,
    }))
      await page.locator(`[name="${name}"]`).fill(value);
    await page.locator('[name="termsAccepted"]').check();
    await page.locator('[name="privacyAcknowledged"]').check();
    const digest = await solveCaptcha(page);
    let tampered = false;
    await page.route("**/en/signup", async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.headers()["next-action"])
        return route.continue();
      const original = request.postDataBuffer()!.toString();
      expect(original).toContain(strong);
      tampered = true;
      await route.continue({
        postData: original.replaceAll(strong, "P@ssw0rd!"),
      });
    });
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator("#password-error")).toHaveText(
      en.Signup.errors.weak,
    );
    expect(tampered).toBe(true);
    expect(
      (await pool.query("SELECT id FROM users WHERE email=$1", [email])).rows,
    ).toEqual([]);
    expect(
      (
        await pool.query(
          "SELECT challenge_hash FROM captcha_uses WHERE challenge_hash=$1",
          [digest],
        )
      ).rows,
    ).toEqual([]);
    await expect(page.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      en.PasswordStrength.empty,
    );
  } finally {
    await pool.query("DELETE FROM users WHERE email=$1", [email]);
  }
});

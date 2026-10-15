import { createHash, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { expect, test } from "./fixtures";

loadEnvConfig(process.cwd(), true);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
test.afterAll(() => pool.end());

for (const locale of ["en", "es"]) test(`${locale} signup shows localized ALTCHA widget`, async ({ page }) => {
  await page.goto(`/${locale}/signup`);
  const widget = page.locator("altcha-widget");
  await expect(widget).toBeVisible();
  await expect(widget).toHaveAttribute("language", locale);
  await expect(widget.getByRole("checkbox")).toBeVisible();
  await expect(widget).toHaveAttribute("challenge", "/api/altcha/challenge");
});

test("signup cannot bypass verification by deleting the CAPTCHA field", async ({ page }) => {
  const email = `captcha-bypass-${randomUUID()}@example.test`;
  try {
    await page.goto("/en/signup");
    for (const [name, value] of Object.entries({ firstName: "Ada", lastName: "Lovelace", email, password: "x", dateOfBirth: "1815-12-10" })) await page.locator(`[name="${name}"]`).fill(value);
    await page.locator("form").evaluate((form: HTMLFormElement) => {
      form.noValidate = true;
      form.addEventListener("formdata", (event) => event.formData.delete("altcha"));
    });
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("verification");
    expect((await pool.query("SELECT count(*)::int AS count FROM users WHERE email=$1", [email])).rows[0].count).toBe(0);
    expect((await page.context().cookies()).find((cookie) => cookie.name === "track_atlas_session")).toBeUndefined();
  } finally { await pool.query("DELETE FROM users WHERE email=$1", [email]); }
});

test("challenge endpoint does not cache or disclose its signing secret", async ({ request }) => {
  const first = await request.get("/api/altcha/challenge");
  expect(first.status()).toBe(200);
  expect(first.headers()["cache-control"]).toContain("no-store");
  const challenge = await first.json();
  const other = await (await request.get("/api/altcha/challenge")).json();
  expect(challenge.parameters.nonce).not.toBe(other.parameters.nonce);
  expect(challenge.parameters.data.purpose).toBe("signup");
  expect(JSON.stringify(challenge)).not.toContain(process.env.ALTCHA_HMAC_SECRET!);
});

test("real widget proof expires after one submission and refreshes on validation error", async ({ page }) => {
  const email = `captcha-replay-${randomUUID()}@example.test`;
  let digest = "";
  try {
    await page.goto("/en/signup");
    for (const [name, value] of Object.entries({ firstName: "Ada", lastName: "Lovelace", email, password: "x", dateOfBirth: "1815-12-10" })) await page.locator(`[name="${name}"]`).fill(value);
    await page.locator("altcha-widget").getByRole("checkbox").click();
    const proof = page.locator('input[name="altcha"]');
    await expect(proof).not.toHaveValue("");
    const payload = await proof.inputValue();
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString());
    digest = createHash("sha256").update(decoded.challenge.signature).digest("hex");
    // A duplicate account consumes a valid proof but returns an ordinary form
    // error; the widget must reset rather than resubmitting a now-used proof.
    await pool.query("INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES('Existing','User',$1,'synthetic','2000-01-01')", [email]);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.locator('[name="email"]')).toHaveAttribute("aria-invalid", "true");
    await expect(proof).toHaveValue("");
    await expect(page.locator("altcha-widget").getByRole("checkbox")).not.toBeChecked();
    expect((await pool.query("SELECT count(*)::int AS count FROM captcha_uses WHERE challenge_hash=$1", [digest])).rows[0].count).toBe(1);
  } finally {
    await pool.query("DELETE FROM users WHERE email=$1", [email]);
    if (digest) await pool.query("DELETE FROM captcha_uses WHERE challenge_hash=$1", [digest]);
  }
});

import { createHash } from "node:crypto";
import type { Page, Locator } from "@playwright/test";
import { expect } from "./fixtures";

export async function solveCaptcha(page: Page, scope?: Locator) {
  const root = scope ?? page;
  await root.locator("altcha-widget").getByRole("checkbox").click();
  const field = root.locator('input[name="altcha"]');
  await expect(field).toHaveValue(/.+/, { timeout: 10_000 });
  const payload = JSON.parse(
    Buffer.from(await field.inputValue(), "base64").toString(),
  );
  return createHash("sha256").update(payload.challenge.signature).digest("hex");
}

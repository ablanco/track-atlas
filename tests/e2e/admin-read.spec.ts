import { expect, test } from "@playwright/test";
test("admin read endpoints reject guests without exposing records", async ({
  page,
}) => {
  for (const path of [
    "/api/admin/overview",
    "/api/admin/users",
    "/api/admin/sessions/%5B%22missing%22%5D",
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(401);
    expect(response?.headers()["cache-control"]).toBe("private, no-store");
    await expect(page.locator("body")).toContainText("unauthorized");
  }
});

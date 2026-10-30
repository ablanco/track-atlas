import { expect, selectLanguage, test } from "./fixtures";

test("language selector supports keyboard selection and cancellation", async ({
  page,
}) => {
  await page.goto("/en");
  const selector = page.getByRole("contentinfo").getByRole("combobox");
  await selector.click();
  await page.keyboard.press("Escape");
  await expect(selector).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("option", { name: "English", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/en$/);
  await expect(selector).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/es$/);
  await expect(selector).toContainText("Español");
});

for (const route of ["confirm-email", "reset-password"]) {
  for (const query of [
    "?token=invalid&extra=discard",
    "?token=invalid&token=duplicate",
  ]) {
    test(`${route} language selection drops malformed or duplicate tokens: ${query}`, async ({
      page,
    }) => {
      await page.goto(`/en/${route}${query}`);
      await selectLanguage(page, "Español");
      await expect(page).toHaveURL(new RegExp(`/es/${route}$`));
    });
  }
}

for (const route of ["confirm-email", "reset-password"]) {
  test(`${route} language selection preserves a canonical token and drops unrelated query values`, async ({
    page,
  }) => {
    const token = "A".repeat(43);
    await page.goto(`/en/${route}?token=${token}&extra=discard`);
    await selectLanguage(page, "Español");
    await expect(page).toHaveURL(`/es/${route}?token=${token}`);
    await selectLanguage(page, "English");
    await expect(page).toHaveURL(`/en/${route}?token=${token}`);
  });
}

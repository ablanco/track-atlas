import {
  expect,
  test as base,
  type ConsoleMessage,
  type Locator,
  type Page,
} from "@playwright/test";
import { verifyEmailHarness } from "../helpers/email-harness";

const hydrationError =
  /hydration|hydrated|didn't match|does not match|Minified React error #(418|419|421|422|423|425)\b/i;
const blockingRouteError =
  /blocking-prerender-|blocking route|encountered the unstable value/i;
const clientScriptWarning =
  "Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client. Consider using template tag instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).";

export const test = base.extend<{ browserErrors: void }>({
  browserErrors: [
    async ({ page, baseURL }, use) => {
      await verifyEmailHarness(baseURL);
      const errors: string[] = [];
      const onPageError = (error: Error) =>
        errors.push(`Uncaught page error: ${error.message}`);
      const onConsole = (message: ConsoleMessage) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (hydrationError.test(text)) {
          errors.push(`Hydration console error: ${text}`);
        } else if (blockingRouteError.test(text)) {
          errors.push(`Blocking route console error: ${text}`);
        } else if (text === clientScriptWarning) {
          errors.push(`Client script console error: ${text}`);
        }
      };
      page.on("pageerror", onPageError);
      page.on("console", onConsole);
      await use();
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
      expect(
        errors,
        "Uncaught page errors, blocking routes, hydration mismatches and client script errors",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function selectTheme(page: Page, theme: "light" | "dark") {
  const toggle = page.getByRole("switch");
  await expect(toggle).toBeEnabled();
  if ((await toggle.getAttribute("aria-checked")) !== String(theme === "dark"))
    await toggle.click();
  await expectTheme(page, theme);
}

export async function expectTheme(page: Page, theme: "light" | "dark") {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
  await expectColor(
    page.locator("body"),
    "background-color",
    theme === "light" ? "#ffffff" : "#0a0a0a",
  );
  await expectColor(
    page.locator("body"),
    "color",
    theme === "light" ? "#0a0a0a" : "#fafafa",
  );
}

// Normalize CSS Color 4 values (lab/oklch) through the browser's color engine.
export async function expectColor(
  locator: Locator,
  property: string,
  expected: string,
) {
  await expect
    .poll(
      () =>
        locator.evaluate(
          (element, { property, expected }) => {
            const context = document.createElement("canvas").getContext("2d")!;
            const colors = [
              getComputedStyle(element).getPropertyValue(property),
              expected,
            ].map((color) => {
              context.clearRect(0, 0, 1, 1);
              context.fillStyle = color;
              context.fillRect(0, 0, 1, 1);
              return Array.from(context.getImageData(0, 0, 1, 1).data).join(
                ",",
              );
            });
            return colors[0] === colors[1] ? "match" : colors[0];
          },
          { property, expected },
        ),
      { message: `${property} should render as ${expected}` },
    )
    .toBe("match");
}

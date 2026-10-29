import { selectTheme, expect, expectTheme, test } from "./fixtures";

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [375, 1440]) {
      test(`${locale} ${theme} at ${width}px: accessible responsive homepage`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(`/${locale}`);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.locator("#discover")).toBeVisible();
        await expect(page.getByRole("main")).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          locale === "en"
            ? "Find your way. Keep the journey."
            : "Encuentra tu rumbo. Conserva el camino.",
        );
        await expect(
          page.getByRole("img", {
            name:
              locale === "en"
                ? "Illustration of multiple tracks across a topographic map"
                : "Ilustración de varias rutas sobre un mapa topográfico",
          }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await expect(
          page.getByRole("switch", {
            name: locale === "en" ? "Theme" : "Tema",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "English", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "Español", exact: true }),
        ).toBeVisible();
        const header = page.locator("header");
        await expect(
          header.getByRole("link", { name: "Discover" }),
        ).toHaveCount(0);
        await expect(
          header.getByRole("link", { name: "How it works" }),
        ).toHaveCount(0);
        await expect(header.getByRole("switch")).toHaveCount(0);
        await expect(
          header.getByRole("navigation", {
            name: locale === "en" ? "Language" : "Idioma",
          }),
        ).toHaveCount(0);
        const footer = page.getByRole("contentinfo");
        const footerGithub = footer.locator(
          'a[href="https://github.com/ablanco/track-atlas"]',
        );
        await expect(footerGithub).toBeVisible();
        const alternateLanguage = footer.locator(
          `a[href$="/${locale === "en" ? "es" : "en"}"]`,
        );
        await expect(alternateLanguage).toHaveCount(1);
        expect(
          await footerGithub.evaluate(
            (link, languageLink) => link.parentElement?.contains(languageLink),
            await alternateLanguage.elementHandle(),
          ),
        ).toBe(true);
        const githubLinks = page.locator(
          'a[href="https://github.com/ablanco/track-atlas"]',
        );
        await expect(githubLinks).toHaveCount(2);
        for (const link of await githubLinks.all()) {
          const icon = link.locator('svg[aria-hidden="true"]');
          await expect(icon).toBeVisible();
          await expect(icon).toHaveAttribute("focusable", "false");
          await expect(icon).toHaveCSS("width", "16px");
          await expect(icon).toHaveCSS("height", "16px");
          await expect(icon).toHaveCSS(
            "fill",
            await link.evaluate((element) => getComputedStyle(element).color),
          );
        }
        const controlContrast = await page
          .getByRole("switch")
          .evaluate((select) => {
            const luminance = (color: string) => {
              const context = document
                .createElement("canvas")
                .getContext("2d")!;
              context.fillStyle = color;
              context.fillRect(0, 0, 1, 1);
              const channels = Array.from(context.getImageData(0, 0, 1, 1).data)
                .slice(0, 3)
                .map((value) => {
                  const v = value / 255;
                  return v <= 0.04045
                    ? v / 12.92
                    : ((v + 0.055) / 1.055) ** 2.4;
                });
              return (
                channels[0] * 0.2126 +
                channels[1] * 0.7152 +
                channels[2] * 0.0722
              );
            };
            const ratio = (a: string, b: string) => {
              const x = luminance(a),
                y = luminance(b);
              return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
            };
            const style = getComputedStyle(select);
            const page = getComputedStyle(document.body).backgroundColor;
            return [
              ratio(style.backgroundColor, page),
              ratio(
                getComputedStyle(
                  select.querySelector("[data-slot=switch-thumb]")!,
                ).backgroundColor,
                style.backgroundColor,
              ),
            ];
          });
        for (const contrast of controlContrast)
          expect(contrast).toBeGreaterThanOrEqual(3);
        await page.keyboard.press("Tab");
        const skip = page.locator('a[href="#main-content"]');
        await expect(skip).toBeFocused();
        await expect(skip).toBeVisible();
        await expect(skip).toHaveCSS("outline-style", "solid");
        await page.keyboard.press("Enter");
        await expect(page.getByRole("main")).toBeFocused();
        const colors = await page.locator("svg[data-map]").evaluate((svg) => {
          const style = getComputedStyle(svg);
          return {
            background: getComputedStyle(svg.querySelector("rect")!).fill,
            track: getComputedStyle(svg.querySelector("[data-track]")!).stroke,
            expectedBackground: style
              .getPropertyValue("--map-background")
              .trim(),
            expectedTrack: style.getPropertyValue("--map-track-primary").trim(),
          };
        });
        const rgb = (hex: string) =>
          `rgb(${hex
            .slice(1)
            .match(/../g)!
            .map((c) => parseInt(c, 16))
            .join(", ")})`;
        expect(colors.background).toBe(rgb(colors.expectedBackground));
        expect(colors.track).toBe(rgb(colors.expectedTrack));
        expect(colors.background).toBe(
          theme === "light" ? "rgb(231, 239, 234)" : "rgb(13, 46, 59)",
        );
      });
    }
  }
}

test("native language navigation remembers preference and preserves theme", async ({
  page,
  context,
}) => {
  await page.goto("/en");
  await selectTheme(page, "dark");
  await expectTheme(page, "dark");
  await page.getByRole("link", { name: "Español", exact: true }).click();
  await expect(page).toHaveURL(/\/es$/);
  await expect(
    page.getByRole("link", { name: "Español", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("switch", { name: "Tema", exact: true }),
  ).toBeChecked();
  await expectTheme(page, "dark");
  expect(
    (await context.cookies()).find((cookie) => cookie.name === "NEXT_LOCALE")
      ?.value,
  ).toBe("es");
  await page.goto("/");
  await expect(page).toHaveURL(/\/es$/);
  await expectTheme(page, "dark");
  await page.getByRole("link", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(
    page.getByRole("switch", { name: "Theme", exact: true }),
  ).toBeChecked();
  await expectTheme(page, "dark");
  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);
  await expectTheme(page, "dark");
});

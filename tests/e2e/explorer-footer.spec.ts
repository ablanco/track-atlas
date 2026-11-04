import { expect, test, expectTheme } from "./fixtures";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { stubBasemap } from "../helpers/map";

for (const locale of ["en", "es"]) {
  for (const width of [375, 1440]) {
    test(`${locale} ${width}px explorer footer drawer shares controls and restores focus`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await stubBasemap(page);
      await page.goto(`/${locale}/tracks?activity=hiking&viewport=-6,36,-5,37`);
      await expect(page.getByRole("contentinfo")).toBeHidden();
      const title =
        locale === "en"
          ? "Information and preferences"
          : "Información y preferencias";
      const trigger = page.getByRole("button", { name: title, exact: true });
      await expect(trigger).toBeEnabled();
      await expect(trigger).toBeInViewport();
      await trigger.focus();
      await expect(page.locator('[data-slot="tooltip-content"]')).toBeVisible();
      await page.keyboard.press("Enter");
      const drawer = page.getByRole("dialog", { name: title });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("link")).toHaveCount(3);
      await expect(
        drawer.getByRole("link", { name: "GitHub" }),
      ).toHaveAttribute("target", "_blank");
      const toggle = drawer.getByRole("switch");
      if ((await toggle.getAttribute("aria-checked")) !== "true")
        await toggle.click();
      await expectTheme(page, "dark");
      await expect(drawer).toBeVisible();
      await toggle.click();
      await expectTheme(page, "light");
      // Repeated tabbing must remain inside the modal, including portaled controls.
      await drawer
        .getByRole("button", {
          name: locale === "en" ? "Close" : "Cerrar",
          exact: true,
        })
        .focus();
      for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
      expect(
        await drawer.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await drawer
        .getByRole("link", {
          name: locale === "en" ? "Privacy Policy" : "Política de privacidad",
        })
        .click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/legal/privacy$`));
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expect(trigger).toBeHidden();
      await page.goBack();
      await expect(trigger).toBeVisible();
      await expect(drawer).toBeHidden();
      await trigger.click();
      await drawer.getByRole("combobox").click();
      await page
        .getByRole("option", {
          name: locale === "en" ? "Español" : "English",
          exact: true,
        })
        .click();
      const other = locale === "en" ? "es" : "en";
      await expect(page).toHaveURL(new RegExp(`/${other}/tracks\\?`));
      const url = new URL(page.url());
      expect(url.searchParams.get("activity")).toBe("hiking");
      expect(url.searchParams.get("viewport")).toBe("-6,36,-5,37");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}

test("drawer is available in collection errors and private list sign-in states", async ({
  page,
}) => {
  await page.route("**/api/tracks/explore?*", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  const database = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
  )
    throw Error("Local development database required");
  const pool = new Pool({ connectionString: database.href });
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES('Footer','Tester',$1,'synthetic','1990-01-01') RETURNING id",
    [`footer-${randomUUID()}@example.test`],
  );
  try {
    for (const path of [
      `/en/users/${rows[0].id}/tracks`,
      "/en/lists/00000000-0000-4000-8000-000000000001",
    ]) {
      await page.goto(path);
      const trigger = page.getByRole("button", {
        name: "Information and preferences",
        exact: true,
      });
      await expect(trigger).toBeVisible();
      await expect(trigger).toBeEnabled();
      await trigger.click();
      const drawer = page.getByRole("dialog", {
        name: "Information and preferences",
      });
      await expect(drawer).toBeVisible();
      await drawer.getByRole("button", { name: "Close", exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  } finally {
    await pool.query("DELETE FROM users WHERE id=$1", [rows[0].id]);
    await pool.end();
  }
});

test("mobile drawer dismisses through its backdrop and swipe handle", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await stubBasemap(page);
  await page.goto("/en/tracks");
  const trigger = page.getByRole("button", {
    name: "Information and preferences",
    exact: true,
  });
  const drawer = page.getByRole("dialog", {
    name: "Information and preferences",
  });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(drawer).toBeVisible();
  await page.mouse.click(180, 100);
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  const handle = page.locator('[data-slot="drawer-swipe-handle"]');
  await handle.hover();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, 810, { steps: 12 });
  await page.mouse.up();
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

for (const width of [375, 1440]) {
  test(`${width}px footer stays clear of drawing instructions and notifications`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await stubBasemap(page);
    await page.route("**/api/tracks/explore?*", (route) =>
      route.fulfill({ status: 503, json: { error: "unavailable" } }),
    );
    await page.goto("/en/tracks");
    if (width === 375)
      await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(page.locator("canvas")).toBeVisible();
    await page.getByRole("button", { name: "Arrow", exact: true }).click();
    const cancel = page.getByRole("button", {
      name: "Cancel drawing",
      exact: true,
    });
    await expect(cancel).toBeVisible();
    const instructions = cancel.locator('xpath=ancestor::*[@role="status"]');
    const trigger = page.getByRole("button", {
      name: "Information and preferences",
      exact: true,
    });
    const buttonBox = (await trigger.boundingBox())!;
    const alertBox = (await instructions.boundingBox())!;
    expect(alertBox.y + alertBox.height).toBeLessThan(buttonBox.y);
    const notificationBottom = await page
      .locator('[data-slot="toast-viewport"]')
      .evaluate((el) => parseFloat(getComputedStyle(el).bottom));
    expect(900 - notificationBottom).toBeLessThan(buttonBox.y);
    if (width === 375) {
      const switchBox = (await page
        .getByRole("button", { name: "List", exact: true })
        .boundingBox())!;
      expect(buttonBox.x + buttonBox.width).toBeLessThan(switchBox.x);
    }
    await trigger.click();
    await expect(
      page.getByRole("dialog", { name: "Information and preferences" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(cancel).toBeVisible();
  });
}

for (const width of [375, 1042]) {
  test(`${width}px opening the footer with loaded track geometry does not loop`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await stubBasemap(page);
    const ids = [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    ];
    await page.route("**/api/tracks/explore?*", (route) =>
      route.fulfill({
        json: {
          tracks: ids.map((id, i) => ({
            id,
            name: `Footer loop regression ${i}`,
            activity: "walking",
            difficulty: 2,
            distanceMeters: 1200,
            visibility: "public",
            owner: {
              id: "20000000-0000-4000-8000-000000000001",
              name: "Walker",
              avatarUrl: null,
            },
          })),
          total: 2,
          page: 1,
          pageCount: 1,
          scopeCount: 2,
          bounds: { maxDistanceKm: 20, maxElevationRangeMeters: 500 },
          collection: null,
          filters: {
            q: "",
            activities: [],
            difficulties: [],
            minDistanceKm: null,
            maxDistanceKm: null,
            maxElevationRangeMeters: null,
            visibility: "all",
            page: 1,
          },
        },
      }),
    );
    const geometries = new Set<string>();
    await page.route("**/explore-geometry", async (route) => {
      geometries.add(new URL(route.request().url()).pathname);
      await route.fulfill({
        json: {
          geometry: {
            type: "LineString",
            coordinates: [
              [-3, 40],
              [-2.99, 40.01],
            ],
          },
        },
      });
    });
    await page.goto("/en/tracks");
    if (width === 375)
      await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect.poll(() => geometries.size).toBe(2);
    const trigger = page.getByRole("button", {
      name: "Information and preferences",
      exact: true,
    });
    await trigger.click();
    const drawer = page.getByRole("dialog", {
      name: "Information and preferences",
    });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("switch").click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(drawer).toBeVisible();
  });
}

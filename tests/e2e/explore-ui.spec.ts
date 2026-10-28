import { test, expect } from "./fixtures";
import { stubBasemap } from "../helpers/map";

test.beforeEach(async ({ page }) => {
  await stubBasemap(page);
});

test("public explorer is reachable from the shared navigation", async ({
  page,
}) => {
  await page.goto("/en");
  await expect(
    page.getByRole("link", { name: "Explore tracks", exact: true }).first(),
  ).toHaveAttribute("href", "/en/tracks");
});

test("explorer lists HTTP results before geometry and debounce preserves shareable search", async ({
  page,
}) => {
  await page.route("**/api/tracks/explore?*", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    await route.fulfill({
      json: {
        tracks: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            name: q ? "Forest loop" : "Coastal walk",
            activity: "walking",
            difficulty: 2,
            distanceMeters: 12345,
            visibility: "public",
            owner: {
              id: "20000000-0000-4000-8000-000000000001",
              name: "Walker",
              avatarUrl: null,
            },
          },
        ],
        total: 1,
        page: 1,
        pageCount: 1,
        scopeCount: 1,
        bounds: { maxDistanceKm: 20, maxElevationRangeMeters: 500 },
        collection: null,
        filters: {
          q,
          activities: [],
          difficulties: [],
          minDistanceKm: null,
          maxDistanceKm: null,
          maxElevationRangeMeters: null,
          visibility: "all",
          page: 1,
        },
      },
    });
  });
  await page.route("**/explore-geometry", (route) => route.abort());
  await page.goto("/en/tracks");
  await expect(
    page.getByRole("link", { name: "Coastal walk", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search titles and tags" })
    .fill("forest");
  await expect(page).toHaveURL(/q=forest/);
  await expect(
    page.getByRole("link", { name: "Forest loop", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("link", { name: "Coastal walk", exact: true }),
  ).toBeVisible();
});

test("filter choices combine in the URL, reset pagination and retain locale links", async ({
  page,
}) => {
  await page.goto("/en/tracks?page=3&q=forest");
  await page
    .getByRole("combobox", { name: "Activity type", exact: true })
    .click();
  await page.getByRole("option", { name: "Hiking", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/activity=hiking/);
  await expect(page).not.toHaveURL(/page=/);
  await page.getByRole("button", { name: "Difficulty 3", exact: true }).click();
  await page
    .getByRole("button", { name: "Distance (km)", exact: true })
    .click();
  const min = page.getByRole("spinbutton", {
    name: "Minimum distance (km)",
    exact: true,
  });
  await min.fill("2.3");
  await min.press("Enter");
  await expect(page).toHaveURL(/minDistance=2.3/);
  await expect(page.getByRole("contentinfo")).toHaveCount(0);
});

test("pagination shows matching count and clears filters from an empty result", async ({
  page,
}) => {
  await page.route("**/api/tracks/explore?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const current = Number(params.get("page") ?? 1);
    const empty = params.has("q");
    await route.fulfill({
      json: {
        tracks: [],
        total: empty ? 0 : 21,
        page: current,
        pageCount: empty ? 1 : 3,
        scopeCount: 21,
        bounds: { maxDistanceKm: 20, maxElevationRangeMeters: 500 },
        collection: null,
        filters: {
          q: params.get("q") ?? "",
          activities: [],
          difficulties: [],
          minDistanceKm: null,
          maxDistanceKm: null,
          maxElevationRangeMeters: null,
          visibility: "all",
          page: current,
        },
      },
    });
  });
  await page.goto("/en/tracks");
  await expect(
    page.getByText("21 matching tracks", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(
    page.getByRole("button", { name: "Page 2", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("searchbox").fill("missing");
  await expect(
    page.getByText("No matching tracks", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .first()
    .click();
  await expect(page).not.toHaveURL(/q=|page=/);
});

test("keyboard selection identifies an entry by number without opening details", async ({
  page,
}) => {
  await page.route("**/api/tracks/explore?*", (route) =>
    route.fulfill({
      json: {
        tracks: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            name: "Coastal walk",
            activity: "walking",
            difficulty: 2,
            distanceMeters: 12345,
            visibility: "public",
            owner: {
              id: "20000000-0000-4000-8000-000000000001",
              name: "Walker",
              avatarUrl: null,
            },
          },
        ],
        total: 1,
        page: 1,
        pageCount: 1,
        scopeCount: 1,
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
  await page.goto("/en/tracks");
  const select = page.getByRole("button", {
    name: "Select track 1: Coastal walk",
    exact: true,
  });
  await select.focus();
  await select.press("Space");
  await expect(select).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/en\/tracks$/);
  await page.getByRole("button", { name: "Walker", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Walker", exact: true }),
  ).toHaveAttribute(
    "href",
    "/en/users/20000000-0000-4000-8000-000000000001/tracks",
  );
});

test("mobile offers List and Map views of the same result page", async ({
  page,
}) => {
  // View switching must not race the real database clamping a missing page.
  await page.route("**/api/tracks/explore?*", (route) =>
    route.fulfill({
      json: {
        tracks: [],
        total: 21,
        page: 2,
        pageCount: 3,
        scopeCount: 21,
        bounds: { maxDistanceKm: 20, maxElevationRangeMeters: 500 },
        collection: null,
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/es/tracks?page=2");
  const list = page.getByRole("button", { name: "Lista", exact: true });
  const map = page.getByRole("button", { name: "Mapa", exact: true });
  await expect(map).toBeVisible();
  await expect(list).toBeHidden();
  await map.click();
  await expect(list).toBeVisible();
  await expect(map).toBeHidden();
  await expect(page).toHaveURL(/page=2/);
  await list.click();
  await expect(map).toBeVisible();
  await expect(list).toBeHidden();
});

test("a failed path leaves its entry available with an individual retry", async ({
  page,
}) => {
  await page.route("**/api/tracks/explore?*", (route) =>
    route.fulfill({
      json: {
        tracks: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            name: "Coastal walk",
            activity: "walking",
            difficulty: 2,
            distanceMeters: 12345,
            visibility: "public",
            owner: {
              id: "20000000-0000-4000-8000-000000000001",
              name: "Walker",
              avatarUrl: null,
            },
          },
        ],
        total: 1,
        page: 1,
        pageCount: 1,
        scopeCount: 1,
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
  await page.route("**/explore-geometry", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.goto("/en/tracks");
  await expect(
    page.getByRole("link", { name: "Coastal walk", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry path: Coastal walk", exact: true }),
  ).toBeVisible();
});

test("pending search survives rapid filters and pagination without stale overwrite", async ({
  page,
}) => {
  await page.route("**/api/tracks/explore?*", (route) =>
    route.fulfill({
      json: {
        tracks: [],
        total: 21,
        page: Number(
          new URL(route.request().url()).searchParams.get("page") ?? 1,
        ),
        pageCount: 3,
        scopeCount: 21,
        bounds: { maxDistanceKm: 20, maxElevationRangeMeters: 500 },
        collection: null,
      },
    }),
  );
  await page.goto("/en/tracks");
  await expect(
    page.getByText("21 matching tracks", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Activity type", exact: true })
    .click();
  await page.getByRole("option", { name: "Hiking", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole("searchbox").fill("forest");
  // Dispatch consecutive user actions before React commits a new query render.
  await page.evaluate(() => {
    for (const label of ["Difficulty 3", "Difficulty 4"]) {
      const button = Array.from(document.querySelectorAll("button")).find(
        (button) =>
          (button.getAttribute("aria-label") ?? button.textContent) === label,
      );
      button!.click();
    }
  });
  await expect(page).toHaveURL(/q=forest/);
  await expect(page).toHaveURL(/activity=hiking/);
  await expect(page).toHaveURL(/difficulty=3/);
  await expect(
    page.getByText("21 matching tracks", { exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("coast");
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await page.clock.runFor(600);
  await expect(page).toHaveURL(/q=coast/);
  await expect(page).not.toHaveURL(/page=/);
  await expect(
    page.getByRole("button", { name: "Page 1", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/activity=hiking/);
  await expect(page).toHaveURL(/difficulty=3/);
  await expect(page.getByRole("searchbox")).toHaveValue("coast");
  await page.goBack();
  await expect(page.getByRole("searchbox")).toHaveValue("forest");
  await page.clock.runFor(600);
  await expect(page).toHaveURL(/q=forest/);
  await expect(page).not.toHaveURL(/page=/);
  // Whitespace-only edits preserve the normalized criterion and may paginate.
  await page.getByRole("searchbox").fill("  forest  ");
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await page.clock.runFor(600);
  await expect(page).toHaveURL(/q=forest/);
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/activity=hiking/);
  await expect(page).toHaveURL(/difficulty=3/);
});

test("early search input is retained or waits for hydration before accepting edits", async ({
  page,
}) => {
  let releaseScripts!: () => void;
  const scripts = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(?:\?.*)?$/, async (route) => {
    await scripts;
    await route.continue();
  });
  await page.goto("/en/tracks", { waitUntil: "commit" });
  const search = page.getByRole("searchbox", {
    name: "Search titles and tags",
  });
  await expect(search).toBeVisible();
  // A server-rendered control must either preserve edits made before hydration,
  // or accept them only once its event handlers can compose URL state.
  const acceptsEarlyEdits = await search.isEnabled();
  if (acceptsEarlyEdits) await search.fill("PENA bosq");
  releaseScripts();
  if (!acceptsEarlyEdits) await search.fill("PENA bosq");
  await expect(page).toHaveURL(/q=PENA\+bosq/);
  await expect(search).toHaveValue("PENA bosq");
});

test("numeric drafts survive initial scope bounds and synchronize their own URL values", async ({
  page,
}) => {
  let releaseMetadata!: () => void;
  const metadata = new Promise<void>((resolve) => {
    releaseMetadata = resolve;
  });
  await page.route("**/api/tracks/explore?*", async (route) => {
    await metadata;
    await route.fulfill({
      json: {
        tracks: [],
        total: 4,
        page: 1,
        pageCount: 1,
        scopeCount: 4,
        bounds: { maxDistanceKm: 20, maxElevationRangeMeters: 500 },
        collection: null,
      },
    });
  });
  await page.goto("/en/tracks");
  await page
    .getByRole("button", { name: "Elevation range (m)", exact: true })
    .click();
  const elevation = page.getByRole("spinbutton", {
    name: "Maximum elevation range (m)",
    exact: true,
  });
  const slider = page.getByRole("slider", {
    name: "Maximum elevation range (m)",
    exact: true,
  });
  await elevation.fill("40");
  releaseMetadata();
  await expect(
    page.getByText("4 matching tracks", { exact: true }),
  ).toBeVisible();
  await expect(elevation).toHaveValue("40");
  await expect(elevation).toBeFocused();
  await elevation.press("Enter");
  await expect(page).toHaveURL(/maxElevationRange=40/);
  await expect(slider).toHaveAttribute("aria-valuenow", "40");
  await slider.scrollIntoViewIfNeeded();
  const thumb = (await slider.boundingBox())!;
  const control = (await page
    .locator('[data-slot="slider"]')
    .filter({ has: slider })
    .boundingBox())!;
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    control.x + control.width / 2,
    control.y + control.height / 2,
  );
  await expect(slider).toHaveAttribute("aria-valuenow", "250");
  await expect(page).toHaveURL(/maxElevationRange=40/);
  await page.mouse.up();
  await expect(page).toHaveURL(/maxElevationRange=250/);
  await expect(elevation).toHaveValue("250");
  await page.goBack();
  await expect(elevation).toHaveValue("40");
  await expect(slider).toHaveAttribute("aria-valuenow", "40");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Elevation range (m)", exact: true })
    .click();
  await expect(elevation).toHaveValue("");
  await expect(slider).toHaveAttribute("aria-valuenow", "500");
});

test("numeric drafts survive a pending search commit while results are loading", async ({
  page,
}) => {
  let releaseResults!: () => void;
  const results = new Promise<void>((resolve) => {
    releaseResults = resolve;
  });
  await page.route("**/api/tracks/explore?*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("q")) await results;
    await route.fulfill({
      json: {
        tracks: [],
        total: 4,
        page: 1,
        pageCount: 1,
        scopeCount: 4,
        bounds: { maxDistanceKm: 20, maxElevationRangeMeters: 500 },
        collection: null,
      },
    });
  });
  await page.goto("/en/tracks?page=2");
  await expect(
    page.getByText("4 matching tracks", { exact: true }),
  ).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole("searchbox").fill("PENA bosq");
  await page
    .getByRole("button", { name: "Elevation range (m)", exact: true })
    .click();
  const elevation = page.getByRole("spinbutton", {
    name: "Maximum elevation range (m)",
    exact: true,
  });
  await elevation.fill("40");
  await page.clock.runFor(350);
  await expect(page).toHaveURL(/q=PENA\+bosq/);
  await expect(page).not.toHaveURL(/page=/);
  await expect(elevation).toHaveValue("40");
  await expect(elevation).toBeFocused();
  await expect(elevation).toBeEnabled();
  await elevation.press("Enter");
  await expect(page).toHaveURL(/maxElevationRange=40/);
  releaseResults();
  await expect(
    page.getByText("4 matching tracks", { exact: true }),
  ).toBeVisible();
});

for (const locale of ["en", "es"] as const) {
  test(`${locale} explorer shows sub-kilometre distances in kilometres`, async ({
    page,
  }) => {
    await page.route("**/api/tracks/explore?*", (route) =>
      route.fulfill({
        json: {
          tracks: [500, 1, 0.01, 0].map((distanceMeters, index) => ({
            id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            name: `Short track ${index}`,
            activity: "walking",
            difficulty: 2,
            distanceMeters,
            visibility: "public",
            owner: {
              id: "20000000-0000-4000-8000-000000000001",
              name: "Walker",
              avatarUrl: null,
            },
          })),
          total: 4,
          page: 1,
          pageCount: 1,
          scopeCount: 4,
          bounds: { maxDistanceKm: 20, maxElevationRangeMeters: 500 },
          collection: null,
        },
      }),
    );
    await page.route("**/explore-geometry", (route) => route.abort());
    await page.goto(`/${locale}/tracks`);
    const distances =
      locale === "en"
        ? ["0.5 km", "0.001 km", "0.00001 km", "0 km"]
        : ["0,5 km", "0,001 km", "0,00001 km", "0 km"];
    for (let index = 0; index < distances.length; index++) {
      const entry = page.getByRole("listitem").filter({
        has: page.getByRole("link", {
          name: `Short track ${index}`,
          exact: true,
        }),
      });
      await expect(entry).toContainText(distances[index]);
    }
  });
}

for (const locale of ["en", "es"] as const) {
  test(`${locale} explorer pluralizes matching counts including zero`, async ({
    page,
  }) => {
    await page.route("**/api/tracks/explore?*", (route) =>
      route.fulfill({
        json: {
          tracks: [],
          total: Number(
            new URL(route.request().url()).searchParams.get("q") ?? 1,
          ),
          page: 1,
          pageCount: 1,
          scopeCount: 2,
          bounds: { maxDistanceKm: 20, maxElevationRangeMeters: 500 },
          collection: null,
        },
      }),
    );
    await page.goto(`/${locale}/tracks`);
    for (const [count, label] of (locale === "en"
      ? [
          [1, "1 matching track"],
          [2, "2 matching tracks"],
          [0, "0 matching tracks"],
        ]
      : [
          [1, "1 track encontrado"],
          [2, "2 tracks encontrados"],
          [0, "0 tracks encontrados"],
        ]) as [number, string][]) {
      if (count !== 1) await page.getByRole("searchbox").fill(String(count));
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });
}

for (const locale of ["en", "es"] as const) {
  test(`${locale} compact toolbar keeps filters on one line and range panels out of layout`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: 1189,
      height: 844,
    });
    await page.emulateMedia({
      colorScheme: locale === "en" ? "light" : "dark",
    });
    await page.goto(`/${locale}/tracks`);
    const search = page.getByRole("searchbox");
    await expect(search).toBeEnabled();
    const toolbar = page.locator("#main-content > div").first();
    const before = (await toolbar.boundingBox())!;
    expect(before.height).toBeLessThanOrEqual(65);
    expect((await search.boundingBox())!.width).toBeLessThanOrEqual(240);
    await expect(search.locator("..").locator("svg")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: locale === "en" ? "Filters" : "Filtros",
        exact: true,
      }),
    ).toHaveCount(0);
    const activity = page.getByRole("combobox", {
      name: locale === "en" ? "Activity type" : "Tipo de actividad",
      exact: true,
    });
    await activity.click();
    await page
      .getByRole("option", {
        name: locale === "en" ? "Hiking" : "Senderismo",
        exact: true,
      })
      .click();
    await page
      .getByRole("option", {
        name: locale === "en" ? "Walking" : "Caminar",
        exact: true,
      })
      .click();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/activity=hiking/);
    await expect(page).toHaveURL(/activity=walking/);
    const distance = page.getByRole("button", {
      name: locale === "en" ? "Distance (km)" : "Distancia (km)",
      exact: true,
    });
    await distance.click();
    const popup = page.getByRole("dialog", {
      name: locale === "en" ? "Distance (km)" : "Distancia (km)",
      exact: true,
    });
    await expect(popup).toBeVisible();
    await expect(popup.getByRole("slider")).toHaveCount(2);
    expect((await toolbar.boundingBox())!.height).toBe(before.height);
    const panel = (await popup.boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(1189);
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(distance).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

for (const locale of ["en", "es"] as const) {
  test(`${locale} mobile filters use a bottom drawer and retain URL state`, async ({
    page,
  }) => {
    const en = locale === "en";
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: en ? "light" : "dark" });
    await page.goto(`/${locale}/tracks`);
    const trigger = page.getByRole("button", {
      name: en ? "Filters" : "Filtros",
      exact: true,
    });
    const toolbar = page.locator("#main-content > div").first();
    await expect(trigger).toBeEnabled();
    await expect(toolbar.getByRole("searchbox")).toBeVisible();
    await expect(toolbar.getByRole("combobox")).toHaveCount(0);
    await expect(toolbar.getByRole("button")).toHaveCount(1);
    expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(65);
    await page.getByRole("searchbox").fill("forest");
    await trigger.click();
    const drawer = page.getByRole("dialog", {
      name: en ? "Filters" : "Filtros",
      exact: true,
    });
    await expect(drawer).toBeVisible();
    await drawer
      .getByRole("button", {
        name: en ? "Difficulty 3" : "Dificultad 3",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/q=forest/);
    await expect(page).toHaveURL(/difficulty=3/);
    const activity = drawer.getByRole("combobox", {
      name: en ? "Activity type" : "Tipo de actividad",
      exact: true,
    });
    await activity.click();
    await page
      .getByRole("option", { name: en ? "Hiking" : "Senderismo", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(/activity=hiking/);
    const minimum = drawer.getByRole("spinbutton", {
      name: en ? "Minimum distance (km)" : "Distancia mínima (km)",
      exact: true,
    });
    await minimum.fill("2.3");
    await minimum.press("Enter");
    await expect(page).toHaveURL(/minDistance=2.3/);
    await expect(drawer.getByRole("slider")).toHaveCount(3);
    const box = (await drawer.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.y + box.height).toBeCloseTo(812, 0);
    await drawer
      .getByRole("button", { name: en ? "Close" : "Cerrar", exact: true })
      .click();
    await expect(drawer).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(minimum).toHaveValue("2.3");
    await drawer
      .getByRole("button", {
        name: en ? "Clear filters" : "Borrar filtros",
        exact: true,
      })
      .click();
    await expect(page).not.toHaveURL(/q=|difficulty=|activity=|minDistance=/);
    await expect(minimum).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();
    await trigger.click();
    await page.setViewportSize({ width: 1189, height: 812 });
    await expect(drawer).not.toBeVisible();
    await expect(trigger).not.toBeVisible();
    await expect(
      page.getByRole("combobox", {
        name: en ? "Activity type" : "Tipo de actividad",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

for (const locale of ["en", "es"] as const) {
  for (const mobile of [false, true]) {
    test.describe(`${locale} ${mobile ? "touch" : "mouse"} entry hints`, () => {
      test.use({ hasTouch: mobile });
      test(`${locale} ${mobile ? "mobile" : "desktop"} compact entries reveal uploader and activity names`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: mobile ? 390 : 1189, height: 844 });
        await page.emulateMedia({
          colorScheme: locale === "en" ? "light" : "dark",
        });
        await page.route("**/api/tracks/explore?*", (route) =>
          route.fulfill({
            json: {
              tracks: [
                {
                  id: "10000000-0000-4000-8000-000000000001",
                  name: "Forest loop",
                  activity: "hiking",
                  difficulty: 3,
                  distanceMeters: 12345,
                  visibility: "public",
                  owner: {
                    id: "20000000-0000-4000-8000-000000000001",
                    name: "Walker",
                    avatarUrl: null,
                  },
                },
              ],
              total: 1,
              page: 1,
              pageCount: 1,
              scopeCount: 1,
              bounds: { maxDistanceKm: 20, maxElevationRangeMeters: 500 },
              collection: null,
            },
          }),
        );
        await page.route("**/explore-geometry", (route) =>
          route.fulfill({
            json: {
              geometry: {
                type: "LineString",
                coordinates: [
                  [-3, 40],
                  [-3.01, 40.01],
                ],
              },
            },
          }),
        );
        await page.goto(`/${locale}/tracks`);
        const entry = page.getByRole("listitem").filter({
          has: page.getByRole("link", { name: "Forest loop", exact: true }),
        });
        const uploader = entry.getByRole("button", {
          name: "Walker",
          exact: true,
        });
        const activityName = locale === "en" ? "Hiking" : "Senderismo";
        const activity = entry.getByRole("button", {
          name: activityName,
          exact: true,
        });
        await expect(activity.locator("svg")).toBeVisible();
        await expect(
          entry.getByText(activityName, { exact: true }),
        ).toHaveCount(0);
        await expect(
          entry.getByRole("link", { name: "Walker", exact: true }),
        ).toHaveCount(0);
        const avatarBox = (await uploader.boundingBox())!;
        const titleBox = (await entry
          .getByRole("link", { name: "Forest loop", exact: true })
          .boundingBox())!;
        expect(avatarBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
        expect(Math.abs(avatarBox.y - titleBox.y)).toBeLessThan(3);
        expect((await entry.boundingBox())!.height).toBeLessThan(
          mobile ? 120 : 100,
        );
        if (mobile) await uploader.tap();
        else await uploader.hover();
        const ownerPopup = page.getByRole("dialog", {
          name: "Walker",
          exact: true,
        });
        await expect(ownerPopup).toBeVisible();
        await expect(
          ownerPopup.getByRole("link", { name: "Walker", exact: true }),
        ).toHaveAttribute(
          "href",
          `/${locale}/users/20000000-0000-4000-8000-000000000001/tracks`,
        );
        await page.keyboard.press("Escape");
        await expect(ownerPopup).not.toBeVisible();
        if (mobile) await activity.tap();
        else await activity.hover();
        const activityPopup = page.getByRole("dialog", {
          name: activityName,
          exact: true,
        });
        await expect(activityPopup).toBeVisible();
        await expect(activityPopup).toHaveText(activityName);
        await expect(page).toHaveURL(new RegExp(`/${locale}/tracks$`));
        await expect(
          entry.getByRole("button", {
            name:
              locale === "en"
                ? "Select track 1: Forest loop"
                : "Seleccionar track 1: Forest loop",
            exact: true,
          }),
        ).toHaveAttribute("aria-pressed", "false");
        await page.keyboard.press("Escape");
        await expect(activityPopup).not.toBeVisible();
        if (!mobile) {
          await page.mouse.move(0, 0);
          await entry
            .getByRole("link", { name: "Forest loop", exact: true })
            .focus();
          await page.keyboard.press("Tab");
          await expect(activity).toBeFocused();
          await expect(activityPopup).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(activityPopup).not.toBeVisible();
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });
    });
  }
}

test("restored spatial criteria remain clearable during search failure and retain other filters", async ({
  page,
}) => {
  await page.route("**/api/tracks/explore?*", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto(
    "/en/tracks?q=forest&activity=hiking&page=3&viewport=170,-20,-170,20&drawMode=arrow&drawStart=179,0&drawEnd=-179,0&corridorKm=1",
  );
  await expect(
    page.getByRole("checkbox", { name: "Map search" }),
  ).toBeChecked();
  await expect(
    page.getByRole("spinbutton", { name: "Corridor on each side (km)" }),
  ).toHaveValue("1");
  const committed = page.url();
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await expect(
    page.getByText("Click or tap the start.", { exact: true }),
  ).toBeVisible();
  expect(page.url()).toBe(committed);
  await expect(page.getByRole("contentinfo")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Clear drawing", exact: true })
    .click();
  await expect(page).not.toHaveURL(/drawMode=|drawStart=|drawEnd=|corridorKm=/);
  await expect(page).toHaveURL(/viewport=/);
  await page.getByRole("checkbox", { name: "Map search" }).click();
  await expect(page).not.toHaveURL(/viewport=/);
  await expect(page).toHaveURL(/q=forest&activity=hiking/);
  await page.goBack();
  await expect(
    page.getByRole("checkbox", { name: "Map search" }),
  ).toBeChecked();
});

test("viewport moves replace history, compose with pending search and never refit results", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/tracks/explore?*", (route) => {
    requests.push(route.request().url());
    return route.fulfill({
      json: {
        tracks: [],
        total: 0,
        page: 1,
        pageCount: 1,
        scopeCount: 1,
        bounds: { maxDistanceKm: 10, maxElevationRangeMeters: 100 },
        collection: null,
        filters: {},
      },
    });
  });
  await page.goto("/en/tracks?q=old");
  const checkbox = page.getByRole("checkbox", {
    name: "Map search",
  });
  await expect(checkbox).toBeEnabled();
  await checkbox.click();
  await expect(page).toHaveURL(/viewport=/);
  const historyLength = await page.evaluate(() => history.length);
  const before = new URL(page.url()).searchParams.get("viewport");
  await page.getByRole("searchbox").fill("forest");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("viewport"))
    .not.toBe(before);
  await expect(page).toHaveURL(/q=forest/);
  expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(
    historyLength + 1,
  );
  const settled = page.url();
  const count = requests.length;
  await page.waitForTimeout(800);
  expect(page.url()).toBe(settled);
  expect(requests.length).toBe(count);
  const canvas = page.locator("canvas");
  await canvas.focus();
  await canvas.press("ArrowRight");
  await expect.poll(() => page.url()).not.toBe(settled);
  expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(
    historyLength + 1,
  );
  await page.goBack();
  await expect(page).toHaveURL(/q=old/);
});

for (const locale of ["en", "es"] as const) {
  test(`${locale}: mobile drawing cancellation, corridor validation and clear survive map failure in dark theme`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/tracks/explore?*", (route) =>
      route.fulfill({ status: 503 }),
    );
    await page.addInitScript(() =>
      localStorage.setItem("track-atlas-theme", "dark"),
    );
    await page.goto(
      `/${locale}/tracks?drawMode=arrow&drawStart=179,0&drawEnd=-179,0&corridorKm=1`,
    );
    const english = locale === "en";
    await page
      .getByRole("button", { name: english ? "Map" : "Mapa", exact: true })
      .click();
    const width = page.getByRole("spinbutton", {
      name: english
        ? "Corridor on each side (km)"
        : "Corredor a cada lado (km)",
    });
    await width.fill("0.01");
    await width.press("Enter");
    await expect(width).toHaveAttribute("aria-invalid", "true");
    await width.blur();
    await width.focus();
    await expect(width).toHaveAccessibleDescription(
      english
        ? "Enter a corridor from 0.1 to 50 km on each side."
        : "Introduce un corredor de 0,1 a 50 km a cada lado.",
    );
    await expect(page).toHaveURL(/corridorKm=1$/);
    await width.fill("0.1");
    await width.press("Enter");
    await expect(page).toHaveURL(/corridorKm=0.1$/);
    await width.fill("50");
    await width.press("Enter");
    await expect(page).toHaveURL(/corridorKm=50$/);
    const committed = page.url();
    await page
      .getByRole("button", {
        name: english ? "Line" : "Línea",
        exact: true,
      })
      .click();
    const canvas = page.locator("canvas");
    const box = (await canvas.boundingBox())!;
    await expect(
      page.getByRole("button", {
        name: english ? "Set start" : "Fijar inicio",
        exact: true,
      }),
    ).toHaveCount(0);
    await canvas.click({
      position: { x: box.width * 0.4, y: box.height * 0.6 },
    });
    await expect(
      page.getByText(
        english
          ? "Click or tap the end. Escape cancels."
          : "Pulsa el final. Escape cancela.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(page.url()).toBe(committed);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", {
        name: english ? "Set end" : "Fijar final",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(page.url()).toBe(committed);
    await page
      .getByRole("button", { name: english ? "Line" : "Línea", exact: true })
      .click();
    await canvas.click({
      position: { x: box.width * 0.4, y: box.height * 0.6 },
    });
    await canvas.click({
      position: { x: box.width * 0.65, y: box.height * 0.6 },
    });
    await expect(page).toHaveURL(/drawMode=line/);
    await expect(page).toHaveURL(/corridorKm=50/);
    await expect(
      page.getByRole("button", {
        name: english ? "Cancel drawing" : "Cancelar dibujo",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator("canvas").dispatchEvent("webglcontextlost");
    await page
      .getByRole("button", {
        name: english ? "Clear drawing" : "Borrar dibujo",
        exact: true,
      })
      .click();
    await expect(page).not.toHaveURL(
      /drawMode=|drawStart=|drawEnd=|corridorKm=/,
    );
  });
}

test("Back restores saved spatial camera after zooming a drawing-only view", async ({
  page,
}) => {
  await page.route("**/api/tracks/explore?*", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto(
    "/en/tracks?viewport=170,-20,-170,20&drawMode=arrow&drawStart=179,0&drawEnd=-179,0&corridorKm=1",
  );
  const start = page.getByLabel("Drawing start", { exact: true });
  await expect(start).toBeInViewport();
  await page.getByRole("checkbox", { name: "Map search" }).click();
  await expect(page).not.toHaveURL(/viewport=/);
  for (let i = 0; i < 8; i++)
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(start).not.toBeInViewport();
  await page.goBack();
  await expect(page).toHaveURL(/viewport=/);
  await expect(start).toBeInViewport();
  await page.reload();
  await expect(
    page.getByLabel("Drawing start", { exact: true }),
  ).toBeInViewport();
});

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
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("button", { name: "Hiking", exact: true }).click();
  await expect(page).toHaveURL(/activity=hiking/);
  await expect(page).not.toHaveURL(/page=/);
  await page.getByRole("button", { name: "Difficulty 3", exact: true }).click();
  const min = page.getByRole("spinbutton", {
    name: "Minimum distance (km)",
    exact: true,
  });
  await min.fill("2.3");
  await min.press("Enter");
  await expect(page).toHaveURL(/minDistance=2.3/);
  await expect(
    page.getByRole("link", { name: "Español", exact: true }),
  ).toHaveAttribute("href", /\/es\/tracks\?.*activity=hiking/);
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/es/tracks?page=2");
  const list = page.getByRole("button", { name: "Lista", exact: true });
  const map = page.getByRole("button", { name: "Mapa", exact: true });
  await expect(list).toHaveAttribute("aria-pressed", "true");
  await map.click();
  await expect(map).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/page=2/);
  await list.click();
  await expect(list).toHaveAttribute("aria-pressed", "true");
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
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.clock.install();
  await page.getByRole("searchbox").fill("forest");
  // Dispatch consecutive user actions before React commits a new query render.
  await page.evaluate(() => {
    for (const label of ["Hiking", "Difficulty 3"]) {
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
  await expect(page).toHaveURL(/page=2/);
  await expect(page).toHaveURL(/activity=hiking/);
  await expect(page).toHaveURL(/difficulty=3/);
  await expect(page.getByRole("searchbox")).toHaveValue("coast");
  await page.goBack();
  await expect(page.getByRole("searchbox")).toHaveValue("forest");
  await page.clock.runFor(600);
  await expect(page).toHaveURL(/q=forest/);
  await expect(page).not.toHaveURL(/page=/);
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

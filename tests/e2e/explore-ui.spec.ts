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

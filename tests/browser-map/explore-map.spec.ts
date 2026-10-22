import { test, expect } from "@playwright/test";
import { stubBasemap } from "../helpers/map";

const geometry = {
  geometry: {
    type: "LineString",
    coordinates: [
      [-3, 40],
      [-2.99, 40.01],
    ],
  },
};

test("paths appear independently, retry failures, and preserve basemap across result changes", async ({
  page,
}) => {
  await stubBasemap(page);
  let failTwo = true;
  await page.route("**/api/tracks/*/explore-geometry", (route) => {
    if (route.request().url().includes("/two/") && failTwo)
      return route.fulfill({ status: 503 });
    return route.fulfill({ json: geometry });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Track one: ready", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Track two: error", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Select track 1: Track one",
      exact: true,
    }),
  ).toBeVisible();
  failTwo = false;
  await page.getByRole("button", { name: "Retry two" }).click();
  await expect(
    page.getByRole("button", {
      name: "Select track 2: Track two",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Basemap", exact: true })
    .selectOption("topographic");
  await page.getByRole("button", { name: "Next results" }).click();
  await expect(
    page.getByRole("button", {
      name: "Select track 1: Track three",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Select track 1: Track one",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Basemap", exact: true }),
  ).toHaveValue("topographic");
});

test("WebGL loss leaves a recovery message and the result controls usable", async ({
  page,
}) => {
  await stubBasemap(page);
  await page.route("**/api/tracks/*/explore-geometry", (route) =>
    route.fulfill({ json: geometry }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", {
      name: "Select track 1: Track one",
      exact: true,
    }),
  ).toBeVisible();
  await page.locator("canvas").dispatchEvent("webglcontextlost");
  await expect(
    page.getByRole("alert").filter({ hasText: "map could not" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next results" }),
  ).toBeEnabled();
});

test("overlapping paths offer a localized keyboard chooser and numbered markers select tracks", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await stubBasemap(page);
  await page.route("**/api/tracks/*/explore-geometry", (route) =>
    route.fulfill({ json: geometry }),
  );
  await page.goto("/");
  const marker = page.getByRole("button", {
    name: "Select track 2: Track two",
    exact: true,
  });
  await expect(marker).toBeVisible();
  await marker.focus();
  await marker.press("Enter");
  await expect(page.getByLabel("Selected")).toHaveText("two");
  await expect(marker).toHaveAttribute("aria-pressed", "true");
  const canvas = page.locator("canvas");
  const box = (await canvas.boundingBox())!;
  await expect(async () => {
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(
      page.getByRole("dialog", { name: "Choose a track" }),
    ).toBeVisible();
  }).toPass({ timeout: 10_000 });
  await page.getByRole("button", { name: "1. Track one", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Selected")).toHaveText("one");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Seleccionar recorrido 1: Track one",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ajustar a los resultados", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("superseded and hidden paths are discarded and Activity return reauthorizes", async ({
  page,
}) => {
  await stubBasemap(page);
  let denied = false;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tracks/*/explore-geometry", async (route) => {
    if (route.request().url().includes("/two/")) await delayed;
    await route.fulfill(denied ? { status: 404 } : { json: geometry });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", {
      name: "Select track 1: Track one",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next results", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Select track 1: Track three",
      exact: true,
    }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("button", {
      name: "Select track 2: Track two",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Toggle activity", exact: true })
    .click();
  denied = true;
  await page
    .getByRole("button", { name: "Toggle activity", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Track three: error", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Select track 1: Track three",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("a full page of bounded display paths has ten matching numbered markers", async ({
  page,
}) => {
  await stubBasemap(page);
  const coordinates = Array.from({ length: 2048 }, (_, i) => [
    -3 + i / 100_000,
    40 + i / 100_000,
  ]);
  await page.route("**/api/tracks/*/explore-geometry", (route) =>
    route.fulfill({ json: { geometry: { type: "LineString", coordinates } } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Full page", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Select track \d+: Maximum/ }),
  ).toHaveCount(10);
  await expect(
    page.getByRole("button", {
      name: "Select track 10: Maximum 10",
      exact: true,
    }),
  ).toHaveText("10");
  await expect(
    page.getByRole("button", { name: /^Maximum \d+: ready$/ }),
  ).toHaveCount(10);
});

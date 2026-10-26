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

test("keyboard drawing keeps the committed filter during replacement and cancels with Escape", async ({
  page,
}) => {
  await stubBasemap(page);
  await page.route("**/api/tracks/*/explore-geometry", (route) =>
    route.fulfill({ json: geometry }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Arrow", exact: true }).click();
  await expect(
    page.getByText("Click the start, or pan the crosshair and set start.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Set start", exact: true }).click();
  const canvas = page.locator("canvas");
  await canvas.focus();
  await canvas.press("ArrowRight");
  await page.getByRole("button", { name: "Set end", exact: true }).click();
  await expect(page.getByLabel("Committed drawing")).toContainText(
    '"mode":"arrow"',
  );
  const original = await page.getByLabel("Committed drawing").textContent();
  await page
    .getByRole("button", { name: "Replace drawing", exact: true })
    .click();
  await page.getByRole("button", { name: "Set start", exact: true }).click();
  await expect(page.getByLabel("Committed drawing")).toHaveText(original!);
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Set end", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Committed drawing")).toHaveText(original!);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Set end", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Committed drawing")).toHaveText(original!);
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await expect(page.getByLabel("Committed drawing")).toHaveText(
    original!.replace('"arrow"', '"line"'),
  );
});

test("date-line corridor is rendered in geographic metres and remains stable on zoom", async ({
  page,
}) => {
  await stubBasemap(page);
  await page.route("**/api/tracks/*/explore-geometry", (route) =>
    route.fulfill({ json: geometry }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Date line drawing" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => !!window.explorerSources?.["explore-spatial-corridor"],
      ),
    )
    .toBe(true);
  const ring = await page.evaluate(
    () =>
      (
        window.explorerSources!["explore-spatial-corridor"] as {
          geometry: { coordinates: number[][][] };
        }
      ).geometry.coordinates[0],
  );
  expect(
    Math.max(...ring.map((p) => p[0])) - Math.min(...ring.map((p) => p[0])),
  ).toBeLessThan(2.1);
  // Independent equatorial reference: 1 km north/south is about 0.009044 degrees.
  expect(Math.max(...ring.map((p) => p[1]))).toBeCloseTo(0.009044, 5);
  expect(Math.min(...ring.map((p) => p[1]))).toBeCloseTo(-0.009044, 5);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByLabel("Committed drawing")).toContainText(
    '"corridorKm":1',
  );
  const after = await page.evaluate(
    () =>
      (
        window.explorerSources!["explore-spatial-corridor"] as {
          geometry: { coordinates: number[][][] };
        }
      ).geometry.coordinates[0],
  );
  expect(after).toEqual(ring);
});

test("switching a draft from Arrow to Line preserves its first click", async ({
  page,
}) => {
  await stubBasemap(page);
  await page.route("**/api/tracks/*/explore-geometry", (route) =>
    route.fulfill({ json: geometry }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Track one: ready", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Arrow", exact: true }).click();
  const canvas = page.locator("canvas");
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * 0.4, y: box.height * 0.5 } });
  await expect(
    page.getByRole("button", { name: "Set end", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Set end", exact: true }),
  ).toBeVisible();
  await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.5 } });
  await expect(page.getByLabel("Committed drawing")).toContainText(
    '"mode":"line"',
  );
  await expect(page.getByLabel("Selected")).toBeEmpty();
});

test("restoration frames wrapped viewport or corridor and new results keep the camera and basemap", async ({
  page,
}) => {
  await stubBasemap(page);
  await page.route("**/api/tracks/*/explore-geometry", (route) =>
    route.fulfill({ json: geometry }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Track one: ready", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restore viewport", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        JSON.parse((await page.getByLabel("Camera bounds").textContent())!)
          ?.north ?? 0,
    )
    .toBeCloseTo(20, 4);
  const viewport = await page.getByLabel("Camera bounds").textContent();
  await page
    .getByRole("combobox", { name: "Basemap", exact: true })
    .selectOption("topographic");
  await page.getByRole("button", { name: "Next results", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Track three: ready", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Camera bounds")).toHaveText(viewport!);
  await page
    .getByRole("button", { name: "Restore corridor", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        JSON.parse((await page.getByLabel("Camera bounds").textContent())!)
          ?.west ?? 0,
    )
    .toBeGreaterThan(178);
  const corridor = await page.getByLabel("Camera bounds").textContent();
  await page.getByRole("button", { name: "Full page", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Maximum 10: ready", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Camera bounds")).toHaveText(corridor!);
  await expect(
    page.getByRole("combobox", { name: "Basemap", exact: true }),
  ).toHaveValue("topographic");
});

test("clearing a drawing cancels its replacement and resets the next corridor to one kilometre", async ({
  page,
}) => {
  await stubBasemap(page);
  await page.route("**/api/tracks/*/explore-geometry", (route) =>
    route.fulfill({ json: geometry }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Date line drawing" }).click();
  const width = page.getByRole("spinbutton", {
    name: "Corridor on each side (km)",
  });
  await width.fill("50");
  await width.press("Enter");
  await page.getByRole("button", { name: "Replace drawing" }).click();
  await page.getByRole("button", { name: "Set start", exact: true }).click();
  await page.getByRole("button", { name: "Clear drawing" }).click();
  await expect(
    page.getByRole("button", { name: "Set end", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Date line drawing" }).click();
  await expect(width).toHaveValue("1");
});

for (const spanish of [false, true]) {
  test(`${spanish ? "Spanish" : "English"} drawing endpoints are named passive images and draft markers are decorative`, async ({
    page,
  }) => {
    await stubBasemap(page);
    await page.route("**/api/tracks/*/explore-geometry", (route) =>
      route.fulfill({ json: geometry }),
    );
    await page.goto("/");
    if (spanish)
      await page.getByRole("button", { name: "Language", exact: true }).click();
    await page.getByRole("button", { name: "Date line drawing" }).click();
    await expect(
      page.getByRole("img", {
        name: spanish ? "Inicio del dibujo" : "Drawing start",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", {
        name: spanish ? "Final del dibujo" : "Drawing end",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Map marker", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", {
        name: spanish ? "Reemplazar dibujo" : "Replace drawing",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: spanish ? "Fijar inicio" : "Set start",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Map marker", exact: true }),
    ).toHaveCount(0);
    // Only the two committed endpoints are exposed as images during replacement.
    await expect(
      page.getByRole("img", {
        name: spanish ? /^(Inicio|Final) del dibujo$/ : /^Drawing (start|end)$/,
      }),
    ).toHaveCount(2);
    await page.keyboard.press("Escape");
  });
}

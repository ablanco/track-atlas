import { expect, test, selectTheme } from "./fixtures";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import type { BrowserContext } from "@playwright/test";
import { stubBasemap, mapCoordinates } from "../helpers/map";

loadEnvConfig(process.cwd(), true);
// Keep real uploads and upper-limit rendering sequential within this file;
// the application intentionally rejects excess concurrent processing workers.
test.describe.configure({ mode: "default" });
let pool: Pool;
test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});
const owners = new Set<string>();
const gpx = Buffer.from(
  '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test"><trk><trkseg><trkpt lat="40" lon="-3"/><trkpt lat="40.001" lon="-3.001"/></trkseg></trk></gpx>',
);
test.afterAll(() => pool.end());
test.beforeEach(async ({ page }, testInfo) => {
  if (!testInfo.title.includes("live hosted basemap")) await stubBasemap(page);
});
test.afterEach(async () => {
  for (const id of owners) {
    await pool.query("DELETE FROM tracks WHERE owner_id=$1", [id]);
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [id]);
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
  }
  owners.clear();
});
async function account(
  context: BrowserContext,
  baseURL: string,
  confirmed = true,
) {
  const token = randomBytes(32).toString("base64url");
  const {
    rows: [user],
  } = await pool.query(
    "INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth,email_confirmed) VALUES('Ada','Lovelace',$1,'synthetic','1815-12-10',$2) RETURNING id",
    [`tracks-${randomUUID()}@example.test`, confirmed],
  );
  owners.add(user.id);
  await pool.query(
    "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
    [user.id, createHash("sha256").update(token).digest("hex")],
  );
  await context.addCookies([
    {
      name: "track_atlas_session",
      value: token,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
async function fillTrack(
  page: import("@playwright/test").Page,
  en: boolean,
  fileBytes = gpx,
) {
  await page
    .getByLabel(en ? "Name" : "Nombre", { exact: true })
    .fill("Private ridge");
  await page
    .getByLabel(en ? "Description" : "Descripción", { exact: true })
    .fill("First line\n<script>plain text</script>");
  await page
    .getByLabel(en ? "GPX file" : "Archivo GPX", { exact: true })
    .setInputFiles({
      name: "ridge.gpx",
      mimeType: "application/gpx+xml",
      buffer: fileBytes,
    });
  await page
    .getByRole("combobox", { name: en ? "Activity type" : "Tipo de actividad" })
    .press("Enter");
  await expect(page.getByRole("option")).toHaveCount(16);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox")).toContainText(
    en ? "Hiking" : "Senderismo",
  );
  await page.getByRole("radio", { name: "3", exact: true }).check();
  const tags = page.getByRole("textbox", { name: en ? /Tags/ : /Etiquetas/ });
  await tags.fill("High ridge");
  await tags.press("Enter");
}
for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    const en = locale === "en";
    test(`${locale} ${theme} accessible analytics charts`, async ({
      context,
      page,
      baseURL,
    }) => {
      test.skip(
        !!process.env.TEST_BASE_URL,
        "Requires isolated local storage harness",
      );
      await account(context, baseURL!);
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}`);
      await selectTheme(page, theme);
      await page.getByRole("button", { name: "Ada L.", exact: true }).click();
      await page
        .getByRole("menuitem", {
          name: en ? "Upload track" : "Subir recorrido",
        })
        .click();
      await fillTrack(
        page,
        en,
        Buffer.from(
          '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test"><trk><trkseg><trkpt lat="40" lon="-3"><ele>10</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="40.001" lon="-3.001"><ele>20</ele><time>2026-01-01T00:01:00Z</time></trkpt></trkseg></trk></gpx>',
        ),
      );
      await page
        .getByRole("button", {
          name: en ? "Upload track" : "Subir recorrido",
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/tracks/[0-9a-f-]{36}$`),
      );
      await expect(
        page.getByRole("region", {
          name: en ? "Recorded analytics" : "Estadísticas registradas",
        }),
      ).toContainText("10 m");
      const elevationChart = page.getByRole("group", {
        name: new RegExp(
          en
            ? "Elevation by recorded distance"
            : "Altitud según la distancia registrada",
        ),
      });
      const speedChart = page.getByRole("group", {
        name: new RegExp(
          en
            ? "Average speed by recorded distance"
            : "Velocidad media según la distancia registrada",
        ),
      });
      await expect(elevationChart).toBeVisible();
      await expect(speedChart).toBeVisible();
      const keyboardChart = elevationChart.locator('[tabindex="0"]');
      await expect(keyboardChart).toBeVisible();
      await keyboardChart.focus();
      await keyboardChart.press("ArrowRight");
      await expect(keyboardChart).toBeFocused();
      await expect(
        page.locator(".recharts-tooltip-wrapper").first(),
      ).toBeVisible();
      await expect(
        page.getByText(
          en
            ? /speed is an interval average/i
            : /La velocidad es un promedio del intervalo/i,
        ),
      ).toBeVisible();
      const elevationPath = await elevationChart
        .locator(".recharts-line-curve")
        .getAttribute("d");
      await selectTheme(page, theme === "dark" ? "light" : "dark");
      await expect(
        elevationChart.locator(".recharts-line-curve"),
      ).toHaveAttribute("d", elevationPath!);
      await expect(page.locator(".recharts-line-curve")).toHaveCount(2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    });
  }
}

test("interactive map retains the original recorded path and isolates provider failures", async ({
  context,
  page,
  baseURL,
}) => {
  await account(context, baseURL!);
  const id = await createAnalyticsTrack(context, baseURL!, gpx);
  await page.goto(`/en/tracks/${id}`);
  const map = page.getByRole("region", {
    name: "Recorded path map",
    exact: true,
  });
  await expect(
    map.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeVisible();
  expect(await mapCoordinates(page)).toEqual([
    [-3, 40],
    [-3.001, 40.001],
  ]);
  await expect(map.getByText("Start", { exact: true })).toBeVisible();
  await expect(map.getByText("End", { exact: true })).toBeVisible();
  await expect(
    map.getByRole("link", { name: "OpenFreeMap", exact: true }),
  ).toBeVisible();
  await page.unroute("https://tiles.openfreemap.org/**");
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  await page.reload();
  await expect(map.getByRole("alert")).toContainText(
    "The map could not be loaded",
  );
  await expect(
    page.getByRole("link", { name: "Download original GPX" }),
  ).toBeVisible();
});

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} map controls, loop, dateline and theme stability`, async ({
      context,
      page,
      baseURL,
    }) => {
      const en = locale === "en";
      await account(context, baseURL!);
      const bytes = Buffer.from(
        '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg><trkpt lat="80" lon="179.9"/><trkpt lat="80" lon="179.9"/><trkpt lat="80.01" lon="-179.9"/><trkpt lat="80" lon="179.9"/></trkseg></trk></gpx>',
      );
      const id = await createAnalyticsTrack(context, baseURL!, bytes);
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}/tracks/${id}`);
      await selectTheme(page, theme);
      const map = page.getByRole("region", {
        name: en ? "Recorded path map" : "Mapa del trazado registrado",
        exact: true,
      });
      await expect(map.locator('[aria-busy="false"]')).toBeVisible();
      expect(await mapCoordinates(page)).toEqual([
        [179.9, 80],
        [179.9, 80],
        [180.1, 80.01],
        [179.9, 80],
      ]);
      await expect(map.locator(".maplibregl-marker")).toHaveCount(1);
      const marker = map.getByText(en ? "Start / end" : "Inicio / final", {
        exact: true,
      });
      await expect(marker).toBeVisible();
      const canvas = map.locator("canvas");
      const rect = await canvas.boundingBox();
      const endpoint = await marker.boundingBox();
      expect(endpoint!.x).toBeGreaterThan(rect!.x);
      expect(endpoint!.x + endpoint!.width).toBeLessThan(rect!.x + rect!.width);
      const initialPosition = await map
        .locator(".maplibregl-marker")
        .getAttribute("style");
      await map
        .getByRole("button", { name: en ? "Zoom in" : "Ampliar", exact: true })
        .click();
      await expect(map.locator(".maplibregl-marker")).not.toHaveAttribute(
        "style",
        initialPosition!,
      );
      await map
        .getByRole("button", {
          name: en ? "Fit recorded path" : "Ajustar al trazado registrado",
        })
        .click();
      await expect(map.locator(".maplibregl-marker")).toHaveAttribute(
        "style",
        initialPosition!,
      );
      const loads = await page.evaluate(() => window.recordedMapLoads);
      await selectTheme(page, theme === "dark" ? "light" : "dark");
      expect(await page.evaluate(() => window.recordedMapLoads)).toBe(loads);
      await expect(map.locator("canvas")).toHaveCount(1);
      await map
        .getByRole("button", {
          name: en ? "Enter fullscreen" : "Entrar en pantalla completa",
        })
        .click();
      await expect(map.locator(":fullscreen")).toBeVisible();
      await expect(
        map.getByRole("link", { name: "OpenFreeMap", exact: true }),
      ).toBeVisible();
      await map
        .getByRole("button", {
          name: en ? "Exit fullscreen" : "Salir de pantalla completa",
        })
        .click();
      await expect(map.locator(":fullscreen")).toHaveCount(0);
      await canvas.focus();
      await page.keyboard.press("Tab");
      await expect(canvas).not.toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}

test("client navigation releases map resources and restores the correct Track geometry", async ({
  context,
  page,
  baseURL,
}) => {
  await account(context, baseURL!);
  const id = await createAnalyticsTrack(context, baseURL!, gpx);
  await page.goto(`/en/tracks/${id}`);
  const readyMap = page.locator('.track-map[aria-busy="false"]:visible');
  const visibleCanvas = page.locator(".track-map canvas:visible");
  await expect(readyMap).toBeVisible();
  expect(await mapCoordinates(page)).toEqual([
    [-3, 40],
    [-3.001, 40.001],
  ]);
  const workerCount = await page.evaluate(() => window.activeMapWorkers ?? 0);
  expect(workerCount).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Upload another track" }).click();
  await expect(page).toHaveURL(/\/en\/tracks\/upload$/);
  await expect(visibleCanvas).toHaveCount(0);
  // MapLibre 5.24 keeps a single shared worker for its global RTL dispatcher.
  // Per-map sources must be released, and the pool must not grow on navigation.
  await expect
    .poll(() => page.evaluate(() => window.removedWorkerMaps ?? 0))
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(() => window.activeMapWorkers ?? 0),
  ).toBeLessThanOrEqual(workerCount);
  await page.goBack();
  await expect(readyMap).toBeVisible();
  await page.getByRole("link", { name: "Español", exact: true }).click();
  await expect(page).toHaveURL(`/es/tracks/${id}`);
  await expect(readyMap).toBeVisible();
  await expect(visibleCanvas).toHaveCount(1);
  expect(await mapCoordinates(page)).toEqual([
    [-3, 40],
    [-3.001, 40.001],
  ]);
  expect(await page.evaluate(() => window.activeMapWorkers)).toBe(workerCount);
  const removed = await page.evaluate(() => window.removedWorkerMaps ?? 0);
  await page.getByRole("link", { name: "Subir otro recorrido" }).click();
  await expect
    .poll(() => page.evaluate(() => window.removedWorkerMaps ?? 0))
    .toBeGreaterThan(removed);
  const bytes = Buffer.from(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg><trkpt lat="45" lon="2"/><trkpt lat="45.01" lon="2.01"/><trkpt lat="45.02" lon="2.03"/></trkseg></trk></gpx>',
  );
  await fillTrack(page, false, bytes);
  await page
    .getByRole("button", { name: "Subir recorrido", exact: true })
    .click();
  await expect(page).toHaveURL(/\/es\/tracks\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toContain(id);
  await expect(readyMap).toBeVisible();
  expect(await mapCoordinates(page)).toEqual([
    [2, 45],
    [2.01, 45.01],
    [2.03, 45.02],
  ]);
  await expect(visibleCanvas).toHaveCount(1);
  expect(await page.evaluate(() => window.activeMapWorkers)).toBe(workerCount);
});

for (const fault of [
  "unauthorized geometry",
  "malformed geometry",
  "worker",
  "library",
  "WebGL",
] as const) {
  test(`map ${fault} failure is contained and retryable`, async ({
    context,
    page,
    baseURL,
  }) => {
    await account(context, baseURL!);
    const id = await createAnalyticsTrack(context, baseURL!, gpx);
    if (fault === "unauthorized geometry")
      await page.route(`**/api/tracks/${id}/data`, (route) =>
        route.fulfill({ status: 404, json: { error: "notFound" } }),
      );
    if (fault === "malformed geometry")
      await page.route(`**/api/tracks/${id}/data`, (route) =>
        route.fulfill({
          json: {
            geometry: {
              type: "LineString",
              coordinates: [
                [null, 4],
                [1, 2],
              ],
            },
          },
        }),
      );
    if (fault === "library")
      await page.route("**/*maplibre*.js", (route) => route.abort());
    if (fault === "worker")
      await page.addInitScript(() => {
        const Original = window.Worker;
        window.Worker = class extends Original {
          constructor(url: string | URL, options?: WorkerOptions) {
            if (String(url).startsWith("blob:"))
              throw Error("Worker unavailable");
            super(url, options);
          }
        };
      });
    await page.goto(`/en/tracks/${id}`);
    const map = page.getByRole("region", {
      name: "Recorded path map",
      exact: true,
    });
    if (fault === "WebGL") {
      await expect(map.locator('[aria-busy="false"]')).toBeVisible();
      await map.locator("canvas").dispatchEvent("webglcontextlost");
    }
    await expect(map.getByRole("alert")).toContainText(
      "The map could not be loaded",
    );
    await expect(
      page.getByRole("heading", { name: "Analytics fixture" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download original GPX" }),
    ).toBeVisible();
    if (fault !== "worker") {
      await page.unroute(`**/api/tracks/${id}/data`);
      await page.unroute("**/*maplibre*.js");
      await map.getByRole("button", { name: "Reload map" }).click();
      await expect(map.locator('[aria-busy="false"]')).toBeVisible();
    }
  });
}

test("live hosted basemap integration keeps recording data same-origin", async ({
  context,
  page,
  baseURL,
}) => {
  test.skip(
    process.env.RUN_LIVE_BASEMAP !== "1",
    "Explicit provider integration check",
  );
  test.setTimeout(90_000);
  await account(context, baseURL!);
  const id = await createAnalyticsTrack(context, baseURL!, gpx);
  const external: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://tiles.openfreemap.org/")) {
      external.push(request.url());
      expect(request.postData()).toBeNull();
      expect(request.headers().referer).toBeFalsy();
      expect(request.url()).not.toContain(id);
    }
  });
  await page.goto(`/en/tracks/${id}`);
  const map = page.getByRole("region", {
    name: "Recorded path map",
    exact: true,
  });
  await expect(map.locator('[aria-busy="false"]')).toBeVisible({
    timeout: 45_000,
  });
  await expect(
    map.getByRole("link", { name: "OpenStreetMap", exact: true }),
  ).toBeVisible();
  await expect.poll(() => external.length).toBeGreaterThan(3);
  await expect(map.getByRole("alert")).toHaveCount(0);
});

async function createAnalyticsTrack(
  context: BrowserContext,
  baseURL: string,
  bytes: Buffer,
) {
  const response = await context.request.post("/api/tracks", {
    headers: { origin: baseURL },
    multipart: {
      name: "Analytics fixture",
      description: "Recorded analytics fixture",
      activity: "hiking",
      difficulty: "3",
      tags: JSON.stringify(["analytics"]),
      requestId: randomUUID(),
      file: {
        name: "analytics.gpx",
        mimeType: "application/gpx+xml",
        buffer: bytes,
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).id as string;
}

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} partial chart gaps and lazy-library failure isolation`, async ({
      context,
      page,
      baseURL,
    }) => {
      test.skip(
        !!process.env.TEST_BASE_URL,
        "Requires isolated local storage harness",
      );
      const en = locale === "en";
      await account(context, baseURL!);
      const id = await createAnalyticsTrack(
        context,
        baseURL!,
        Buffer.from(
          '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test"><trk><trkseg><trkpt lat="40" lon="-3"><ele>10</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="40.001" lon="-3.001"><ele>20</ele><time>2026-01-01T00:01:00Z</time></trkpt><trkpt lat="40.002" lon="-3.002"/><trkpt lat="40.003" lon="-3.003"><ele>5</ele><time>2026-01-01T00:03:00Z</time></trkpt><trkpt lat="40.004" lon="-3.004"><ele>30</ele><time>2026-01-01T00:04:00Z</time></trkpt></trkseg></trk></gpx>',
        ),
      );
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}/tracks/${id}`);
      await selectTheme(page, theme);
      const analytics = page.getByRole("region", {
        name: en ? "Recorded analytics" : "Estadísticas registradas",
      });
      await expect(analytics).toContainText(
        en
          ? "Partial elevation coverage: 4 of 5 points"
          : "Cobertura de altitud parcial: 4 de 5 puntos",
      );
      await expect(
        analytics.getByText(en ? "Unavailable" : "No disponible", {
          exact: true,
        }),
      ).toHaveCount(3);
      const curves = page.locator(".recharts-line-curve");
      await expect(curves).toHaveCount(2);
      for (const curve of await curves.all()) {
        expect((await curve.getAttribute("d"))?.match(/M/g)).toHaveLength(2);
      }
      await expect(
        page.getByRole("link", {
          name: en ? "Download original GPX" : "Descargar GPX original",
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const keyboardChart = analytics
        .getByRole("group", {
          name: new RegExp(
            en
              ? "Elevation by recorded distance"
              : "Altitud según la distancia registrada",
          ),
        })
        .locator('[tabindex="0"]');
      await keyboardChart.focus();
      for (let index = 0; index < 5; index++)
        await keyboardChart.press("ArrowLeft");
      await keyboardChart.press("ArrowRight");
      await keyboardChart.press("ArrowRight");
      await expect(
        analytics.getByRole("status").filter({
          hasText: en ? "No recorded value" : "Sin valor registrado",
        }),
      ).toBeVisible();
      // A real failed script request must be contained by the chart boundary.
      await page.route("**/*recharts*.js", (route) => route.abort("failed"));
      await page.reload();
      await expect(
        page.getByRole("alert").filter({
          hasText: en
            ? "Charts could not be loaded"
            : "No se pudieron cargar las gráficas",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Analytics fixture" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", {
          name: en ? "Download original GPX" : "Descargar GPX original",
        }),
      ).toBeVisible();
      await page.unroute("**/*recharts*.js");
      await page
        .getByRole("button", {
          name: en ? "Reload track details" : "Volver a cargar los detalles",
        })
        .click();
      await expect(page.locator(".recharts-line-curve")).toHaveCount(2);
      // Inject malformed chart data only into this test-owned recording to
      // exercise the server-side data failure boundary, without a test bypass.
      const originalData = await context.request.get(`/api/tracks/${id}/data`);
      const { samples } = await originalData.json();
      await pool.query(
        "UPDATE track_data SET samples=$2::jsonb WHERE track_id=$1",
        [id, JSON.stringify(samples.map(() => null))],
      );
      await page.reload();
      await expect(
        page.getByRole("status").filter({
          hasText: en
            ? "Charts could not be loaded"
            : "No se pudieron cargar las gráficas",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Analytics fixture" }),
      ).toBeVisible();
      const download = await context.request.get(`/api/tracks/${id}/download`);
      expect(download.status()).toBe(200);
      await pool.query(
        "UPDATE track_data SET samples=$2::jsonb WHERE track_id=$1",
        [id, JSON.stringify(samples)],
      );
      await page
        .getByRole("link", {
          name: en ? "Reload track details" : "Volver a cargar los detalles",
        })
        .click();
      await expect(page.locator(".recharts-line-curve")).toHaveCount(2);
    });
  }
}

test("100,000 recorded points render bounded charts and responsive keyboard tooltips", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    !!process.env.TEST_BASE_URL,
    "Requires isolated local storage harness",
  );
  await account(context, baseURL!);
  const buffer = Buffer.alloc(10 * 1024 * 1024);
  let offset = buffer.write(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg>',
  );
  for (let index = 0; index < 100_000; index++) {
    const time = new Date(Date.UTC(2024, 0, 1) + index * 1000)
      .toISOString()
      .replace(".000Z", "Z");
    offset += buffer.write(
      `<trkpt lat="${(48 + index * 0.000001).toFixed(6)}" lon="${(2 + index * 0.000002).toFixed(6)}"><ele>${100 + (index % 20)}</ele><time>${time}</time></trkpt>`,
      offset,
    );
  }
  offset += buffer.write("</trkseg></trk></gpx>", offset);
  const id = await createAnalyticsTrack(
    context,
    baseURL!,
    buffer.subarray(0, offset),
  );
  const started = performance.now();
  const mapResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/tracks/${id}/data`),
  );
  const response = await page.goto(`/en/tracks/${id}`);
  await expect(page.locator(".recharts-line-curve")).toHaveCount(2);
  const renderedMilliseconds = Math.round(performance.now() - started);
  const map = page.getByRole("region", {
    name: "Recorded path map",
    exact: true,
  });
  await expect(map.locator('[aria-busy="false"]')).toBeVisible();
  const coordinates = await mapCoordinates(page);
  expect(coordinates).toHaveLength(100_000);
  expect(
    coordinates.every(
      ([lon, lat], index) =>
        lon === Number((2 + index * 0.000002).toFixed(6)) &&
        lat === Number((48 + index * 0.000001).toFixed(6)),
    ),
  ).toBe(true);
  const mapRenderedMilliseconds = Math.round(performance.now() - started);
  const mapInteractionStarted = performance.now();
  await map.getByRole("button", { name: "Zoom in", exact: true }).click();
  await map.getByRole("button", { name: "Fit recorded path" }).click();
  const mapInteractionMilliseconds = Math.round(
    performance.now() - mapInteractionStarted,
  );
  expect(mapInteractionMilliseconds).toBeLessThan(2000);
  await expect(
    page.getByText(
      "Chart display is reduced for responsiveness; extrema and data gaps are retained.",
      { exact: true },
    ),
  ).toHaveCount(1);
  const speedSections = page.getByRole("region", {
    name: "Average speed by recorded distance",
  });
  await expect(speedSections.getByText("Chart section 1 / 126")).toBeVisible();
  await speedSections.getByRole("button", { name: "Next section" }).click();
  await expect(speedSections.getByText("Chart section 2 / 126")).toBeVisible();
  const keyboardChart = page
    .getByRole("group", { name: /Elevation by recorded distance/ })
    .locator('[tabindex="0"]');
  const interactionStarted = performance.now();
  await keyboardChart.focus();
  await keyboardChart.press("ArrowRight");
  await expect(page.locator(".recharts-tooltip-wrapper").first()).toBeVisible();
  const interactionMilliseconds = Math.round(
    performance.now() - interactionStarted,
  );
  const metrics = await page.evaluate(() => ({
    svgElements: document.querySelectorAll("svg *").length,
    points: document.querySelectorAll(".recharts-line-dot").length,
  }));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const performanceMetrics = await cdp.send("Performance.getMetrics");
  const heapBytes = performanceMetrics.metrics.find(
    (metric) => metric.name === "JSHeapUsedSize",
  )?.value;
  await cdp.detach();
  await response!.finished();
  const documentBytes = await page.evaluate(
    () =>
      (
        performance.getEntriesByType(
          "navigation",
        )[0] as PerformanceNavigationTiming
      ).decodedBodySize,
  );
  const benchmark = {
    originalPoints: 100_000,
    gpxBytes: offset,
    documentBytes,
    renderedMilliseconds,
    mapRenderedMilliseconds,
    mapInteractionMilliseconds,
    mapDataBytes: (await (await mapResponse).body()).length,
    interactionMilliseconds,
    heapBytes,
    ...metrics,
  };
  console.info("Track chart benchmark", JSON.stringify(benchmark));
  await testInfo.attach("track-chart-benchmark", {
    body: JSON.stringify(benchmark),
    contentType: "application/json",
  });
  expect(metrics.svgElements).toBeLessThan(500);
  expect(interactionMilliseconds).toBeLessThan(2000);
});

test("fragmented 100,000-point elevation remains inspectable in bounded sections", async ({
  context,
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    !!process.env.TEST_BASE_URL,
    "Requires isolated local storage harness",
  );
  await account(context, baseURL!);
  const buffer = Buffer.alloc(10 * 1024 * 1024);
  let offset = buffer.write(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg>',
  );
  for (let index = 0; index < 100_000; index++) {
    offset += buffer.write(
      `<trkpt lat="${(48 + index * 0.000001).toFixed(6)}" lon="${(2 + index * 0.000002).toFixed(6)}">${index % 2 === 0 ? `<ele>${100 + (index % 20)}</ele>` : ""}</trkpt>`,
      offset,
    );
  }
  offset += buffer.write("</trkseg></trk></gpx>", offset);
  const id = await createAnalyticsTrack(
    context,
    baseURL!,
    buffer.subarray(0, offset),
  );
  const started = performance.now();
  const response = await page.goto(`/en/tracks/${id}`);
  const elevation = page.getByRole("region", {
    name: "Elevation by recorded distance",
  });
  await expect(
    elevation.getByRole("button", { name: "Next section" }),
  ).toBeVisible();
  const renderedMilliseconds = Math.round(performance.now() - started);
  await expect(
    elevation.getByRole("status").filter({ hasText: "Chart section" }),
  ).toContainText("1 / 63");
  const interactionStarted = performance.now();
  await elevation.getByRole("button", { name: "Next section" }).click();
  await expect(
    elevation.getByRole("status").filter({ hasText: "Chart section" }),
  ).toContainText("2 / 63");
  const interactionMilliseconds = Math.round(
    performance.now() - interactionStarted,
  );
  const metrics = await page.evaluate(() => ({
    svgElements: document.querySelectorAll("svg *").length,
    isolatedDots: document.querySelectorAll('[data-slot="chart"] circle')
      .length,
  }));
  await response!.finished();
  const documentBytes = await page.evaluate(
    () =>
      (
        performance.getEntriesByType(
          "navigation",
        )[0] as PerformanceNavigationTiming
      ).decodedBodySize,
  );
  console.info(
    "Fragmented chart benchmark",
    JSON.stringify({
      originalPoints: 100_000,
      gpxBytes: offset,
      documentBytes,
      renderedMilliseconds,
      interactionMilliseconds,
      ...metrics,
    }),
  );
  await testInfo.attach("fragmented-chart-benchmark", {
    body: JSON.stringify({
      renderedMilliseconds,
      interactionMilliseconds,
      ...metrics,
    }),
    contentType: "application/json",
  });
  expect(metrics.svgElements).toBeLessThan(2000);
  expect(metrics.isolatedDots).toBeGreaterThan(700);
  expect(interactionMilliseconds).toBeLessThan(2000);

  // A later empty section must not claim that the entire recording lacks data.
  let elevationCount = 0;
  const sparseBytes = Buffer.from(
    buffer
      .subarray(0, offset)
      .toString()
      .replace(/<ele>[^<]*<\/ele>/g, (elevation) =>
        elevationCount++ < 800 ? elevation : "",
      ),
  );
  const sparseId = await createAnalyticsTrack(context, baseURL!, sparseBytes);
  await page.goto(`/en/tracks/${sparseId}`);
  const sparseChart = page.getByRole("region", {
    name: "Elevation by recorded distance",
  });
  await sparseChart.getByRole("button", { name: "Next section" }).click();
  await expect(sparseChart).toContainText(
    "No recorded values in this chart section",
  );
  await expect(sparseChart).not.toContainText(
    "this recording has no elevation samples",
  );
});

test("real HTTP server accepts a valid GPX multipart upload", async ({
  context,
  baseURL,
}) => {
  await account(context, baseURL!);
  const response = await context.request.post("/api/tracks", {
    headers: { origin: baseURL! },
    multipart: {
      name: "HTTP track",
      description: "Two positions",
      activity: "hiking",
      difficulty: "3",
      tags: JSON.stringify(["forest"]),
      requestId: randomUUID(),
      file: { name: "track.gpx", mimeType: "application/gpx+xml", buffer: gpx },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
});
for (const locale of ["en", "es"]) {
  const en = locale === "en";
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} keyboard validation, retry retention and private original`, async ({
      page,
      context,
      request,
      baseURL,
    }) => {
      test.skip(
        !!process.env.TEST_BASE_URL,
        "Requires isolated local storage harness",
      );
      await account(context, baseURL!);
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}`);
      await selectTheme(page, theme);
      await page.getByRole("button", { name: "Ada L.", exact: true }).click();
      await page
        .getByRole("menuitem", {
          name: en ? "Upload track" : "Subir recorrido",
        })
        .click();
      const submit = page.getByRole("button", {
        name: en ? "Upload track" : "Subir recorrido",
        exact: true,
      });
      await submit.click();
      await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
      await expect(page.getByRole("combobox")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(
        page.getByRole("radio", { name: "1", exact: true }),
      ).not.toBeChecked();
      await fillTrack(page, en);
      await expect(
        page.getByRole("status").filter({
          hasText: en ? "Added High ridge." : "Se ha añadido High ridge.",
        }),
      ).toBeVisible();
      const tags = page.getByLabel(en ? "Tags" : "Etiquetas", { exact: true });
      await tags.fill("ＨＩＧＨ ridge");
      await tags.press("Enter");
      await expect(
        page.getByText(
          en ? "This tag is already added." : "Esta etiqueta ya está añadida.",
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: en ? "Remove High ridge" : "Eliminar High ridge",
          exact: true,
        }),
      ).toHaveCount(1);
      await tags.fill("Coastal views");
      await tags.press("Enter");
      await page
        .getByRole("button", {
          name: en ? "Remove Coastal views" : "Eliminar Coastal views",
        })
        .click();
      await expect(tags).toBeFocused();
      await expect(
        page.getByRole("status").filter({
          hasText: en
            ? "Removed Coastal views."
            : "Se ha eliminado Coastal views.",
        }),
      ).toBeVisible();
      // Lose the first response after real publication, then retry through the same public HTTP boundary.
      let firstRequestId: string | undefined;
      let retryRequestId: string | undefined;
      let attempt = 0;
      await page.route("**/api/tracks", async (route) => {
        const body = route.request().postDataBuffer()!.toString();
        const id = body.match(/name="requestId"\r\n\r\n([^\r]+)/)?.[1];
        attempt++;
        if (attempt === 1) {
          firstRequestId = id;
          const response = await route.fetch();
          expect(response.status(), await response.text()).toBe(201);
          await route.abort("failed");
        } else {
          retryRequestId = id;
          await route.continue();
        }
      });
      await submit.click();
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        en ? "temporarily unavailable" : "no está disponible temporalmente",
      );
      await expect(
        page.getByLabel(en ? "Name" : "Nombre", { exact: true }),
      ).toHaveValue("Private ridge");
      await expect(
        page.getByLabel(en ? "GPX file" : "Archivo GPX"),
      ).not.toBeEmpty();
      await submit.click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/tracks/[0-9a-f-]{36}$`),
      );
      expect(firstRequestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(retryRequestId).toBe(firstRequestId);
      const analytics = page.getByRole("region", {
        name: en ? "Recorded analytics" : "Estadísticas registradas",
      });
      await expect(analytics).toBeVisible();
      await expect(
        analytics.getByText(en ? "Unavailable" : "No disponible", {
          exact: true,
        }),
      ).toHaveCount(5);
      await expect(analytics).toContainText(
        en ? "No recorded elevation samples" : "No hay muestras de altitud",
      );
      await expect(
        analytics.getByRole("heading", {
          name: en
            ? "Elevation by recorded distance"
            : "Altitud según la distancia registrada",
        }),
      ).toBeVisible();
      await expect(analytics).toContainText(
        en
          ? "no usable timed intervals"
          : "no contiene intervalos con tiempos válidos",
      );
      await expect(analytics.locator(".recharts-line-curve")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await expect(
        page.getByRole("heading", { name: "Private ridge" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("article")
          .getByText("<script>plain text</script>", { exact: false }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("article")
          .getByText(en ? "Private" : "Privado", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("main")).toContainText("Ada L.");
      await expect(page.getByRole("main")).toContainText(
        en ? "Hiking" : "Senderismo",
      );
      await expect(page.getByRole("main")).toContainText("3 / 5");
      await expect(page.getByRole("main")).toContainText("High ridge");
      await expect(page).toHaveTitle(
        en
          ? "Track details — Track Atlas"
          : "Detalles del recorrido — Track Atlas",
      );
      expect(await page.locator("head").textContent()).not.toContain(
        "Private ridge",
      );
      const download = page.getByRole("link", {
        name: en ? "Download original GPX" : "Descargar GPX original",
      });
      const url = (await download.getAttribute("href"))!;
      const original = await context.request.get(url);
      expect(original.status()).toBe(200);
      expect(await original.body()).toEqual(gpx);
      expect(original.headers()["cache-control"]).toBe("private, no-store");
      const detailsURL = page.url();
      expect((await request.get(url)).status()).toBe(404);
      await account(context, baseURL!);
      expect((await context.request.get(url)).status()).toBe(404);
      await page.goto(detailsURL);
      await expect(
        page.getByRole("heading", {
          name: en ? "Track not found" : "Recorrido no encontrado",
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
  test(`${locale} recoverable HTTP errors retain input and changed payload gets a fresh request`, async ({
    page,
    context,
    baseURL,
  }) => {
    await account(context, baseURL!);
    await page.goto(`/${locale}/tracks/upload`);
    await fillTrack(page, en);
    await expect(
      page.getByLabel(en ? "Name" : "Nombre", { exact: true }),
    ).toHaveValue("Private ridge");
    await expect(
      page.getByRole("radio", { name: "3", exact: true }),
    ).toBeChecked();
    await expect(page.getByRole("combobox")).toContainText(
      en ? "Hiking" : "Senderismo",
    );
    const ids: string[] = [];
    const replies = [
      { status: 422, body: { error: "unsupportedStructure" } },
      { status: 409, body: { error: "processing" } },
      {
        status: 422,
        body: { error: "invalidMetadata", fieldErrors: { name: "tooLong" } },
      },
      { status: 403, body: { error: "emailUnconfirmed" } },
      { status: 401, body: { error: "unauthorized" } },
    ];
    await page.route("**/api/tracks", async (route) => {
      ids.push(
        route
          .request()
          .postDataBuffer()!
          .toString()
          .match(/name="requestId"\r\n\r\n([^\r]+)/)![1],
      );
      const reply = replies[ids.length - 1];
      await route.fulfill({
        status: reply.status,
        contentType: "application/json",
        body: JSON.stringify(reply.body),
      });
    });
    const submit = page.getByRole("button", {
      name: en ? "Upload track" : "Subir recorrido",
      exact: true,
    });
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "exactly one track" : "exactamente un recorrido",
    );
    await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
    await expect(
      page.getByLabel(en ? "Description" : "Descripción", { exact: true }),
    ).toHaveValue("First line\n<script>plain text</script>");
    await expect(page.getByRole("combobox")).toContainText(
      en ? "Hiking" : "Senderismo",
    );
    await expect(
      page.getByRole("radio", { name: "3", exact: true }),
    ).toBeChecked();
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "still processing" : "sigue en proceso",
    );
    expect(ids[1]).toBe(ids[0]);
    await page
      .getByLabel(en ? "Name" : "Nombre", { exact: true })
      .fill("Changed ridge");
    await submit.click();
    await expect(
      page.getByLabel(en ? "Name" : "Nombre", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(ids[2]).not.toBe(ids[0]);
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "Confirm your email" : "Confirma tu correo",
    );
    await expect(
      page
        .getByRole("main")
        .getByRole("alert")
        .getByRole("link", {
          name: en ? "Account settings" : "Ajustes de la cuenta",
        }),
    ).toBeVisible();
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "session expired" : "sesión ha caducado",
    );
    expect(ids[4]).toBe(ids[2]);
  });
  test(`${locale} required text and tag limits count Unicode characters`, async ({
    page,
    context,
    baseURL,
  }) => {
    await account(context, baseURL!);
    await page.goto(`/${locale}/tracks/upload`);
    await fillTrack(page, en);
    let submissions = 0;
    await page.route("**/api/tracks", async (route) => {
      submissions++;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "unavailable" }),
      });
    });
    const name = page.getByLabel(en ? "Name" : "Nombre", { exact: true });
    const description = page.getByLabel(en ? "Description" : "Descripción", {
      exact: true,
    });
    const tags = page.getByLabel(en ? "Tags" : "Etiquetas", { exact: true });
    const submit = page.getByRole("button", {
      name: en ? "Upload track" : "Subir recorrido",
      exact: true,
    });
    await name.fill("🥾".repeat(201));
    await description.fill("🌲".repeat(5001));
    await submit.click();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(description).toHaveAttribute("aria-invalid", "true");
    expect(submissions).toBe(0);
    await tags.fill("🌲".repeat(31));
    await tags.press("Enter");
    await expect(tags).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("button", {
        name: `${en ? "Remove" : "Eliminar"} ${"🌲".repeat(31)}`,
        exact: true,
      }),
    ).toHaveCount(0);
    await tags.fill("🌲".repeat(30));
    await tags.press("Enter");
    await expect(
      page.getByRole("button", {
        name: `${en ? "Remove" : "Eliminar"} ${"🌲".repeat(30)}`,
        exact: true,
      }),
    ).toBeVisible();
    for (let index = 1; index <= 8; index++) {
      await tags.fill(`Tag ${index}`);
      await tags.press("Enter");
    }
    await tags.fill("An eleventh tag");
    await tags.press("Enter");
    await expect(tags).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("button", {
        name: `${en ? "Remove" : "Eliminar"} An eleventh tag`,
        exact: true,
      }),
    ).toHaveCount(0);
    await tags.fill("");
    await name.fill(` ${"🥾".repeat(200)} `);
    await description.fill(` ${"🌲".repeat(5000)} `);
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "temporarily unavailable" : "no está disponible temporalmente",
    );
    expect(submissions).toBe(1);
    await expect(name).toHaveAttribute("aria-invalid", "false");
    await expect(description).toHaveAttribute("aria-invalid", "false");
  });
  test(`${locale} upload explains guest and unconfirmed eligibility`, async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto(`/${locale}/tracks/upload`);
    await expect(
      page.getByRole("link", {
        name: en ? "Create an account" : "Crear una cuenta",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("form", { name: en ? "Upload track" : "Subir recorrido" }),
    ).toHaveCount(0);
    await account(context, baseURL!, false);
    await page.reload();
    await expect(
      page.getByRole("link", {
        name: en ? "Account settings" : "Ajustes de la cuenta",
      }),
    ).toBeVisible();
    await expect(page.getByLabel(en ? "GPX file" : "Archivo GPX")).toHaveCount(
      0,
    );
  });
}

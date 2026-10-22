import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { expect, test, selectTheme } from "./fixtures";
import { stubBasemap } from "../helpers/map";
import type { ExploreResult } from "../../tracks/explore-types";

loadEnvConfig(process.cwd(), true);
test.describe.configure({ mode: "default" });
let pool: Pool;
const owners = new Set<string>();
let marker: string;

test.beforeAll(() => {
  // These fixtures commit rows so the app's independent connections can read
  // them. Require the same local development database as the browser harness.
  const database = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
  )
    throw Error("Explorer acceptance requires a local development database");
  pool = new Pool({ connectionString: database.href });
});
test.beforeEach(async ({ page }) => {
  marker = `accept${randomBytes(6).toString("hex")}`;
  await stubBasemap(page);
});
test.afterEach(async () => {
  for (const id of owners) {
    await pool.query("DELETE FROM tracks WHERE owner_id=$1", [id]);
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [id]);
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
    owners.delete(id);
  }
});
test.afterAll(async () => pool?.end());

async function account() {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth)
     VALUES('Explorer','Tester',$1,'synthetic','1990-01-01') RETURNING id`,
    [`explore-${randomUUID()}@example.test`],
  );
  owners.add(rows[0].id);
  return rows[0].id;
}

async function signIn(
  context: BrowserContext,
  baseURL: string,
  ownerId: string,
) {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO sessions(user_id,token_hash,expires_at)
     VALUES($1,$2,clock_timestamp()+interval '1 hour')`,
    [ownerId, createHash("sha256").update(token).digest("hex")],
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

// Publish complete synthetic records with all deferred constraints enabled.
// No object bytes are needed at the metadata/display-geometry seams under test.
async function track(
  ownerId: string,
  options: {
    name?: string;
    visibility?: "public" | "private";
    distance?: number;
    range?: number;
    activity?: "hiking" | "walking";
    difficulty?: number;
    elevation?: "complete" | "partial" | "absent";
    createdAt?: string;
    tags?: string[];
  } = {},
) {
  const id = randomUUID(),
    fileId = randomUUID(),
    requestId = randomUUID();
  const name = options.name ?? `${marker} Peña ridge`;
  const distance = options.distance ?? 1200;
  const range = options.range ?? 40;
  const coverage = options.elevation ?? "complete";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO stored_files(id,owner_id,purpose,status,storage_location,object_key,byte_size,content_type,sha256)
       VALUES($1::uuid,$2,'gpx','ready',$3,$1::uuid::text,1,'application/gpx+xml',$4)`,
      [fileId, ownerId, "b".repeat(64), "a".repeat(64)],
    );
    await client.query(
      `INSERT INTO tracks(id,owner_id,original_file_id,request_id,name,description,activity,difficulty,visibility,point_count,distance_meters,min_elevation_meters,max_elevation_meters,elevation_sample_count,ascent_meters,descent_meters,version,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,3,$10,$11,$12,$13,$14,$15,1,coalesce($16::timestamptz,clock_timestamp()))`,
      [
        id,
        ownerId,
        fileId,
        requestId,
        name,
        `${marker} descriptiononly`,
        options.activity ?? "hiking",
        options.difficulty ?? 3,
        options.visibility ?? "public",
        distance,
        coverage === "absent" ? null : 10,
        coverage === "absent" ? null : 10 + range,
        coverage === "complete" ? 3 : coverage === "partial" ? 2 : 0,
        coverage === "complete" ? range : null,
        coverage === "complete" ? 0 : null,
        options.createdAt ?? null,
      ],
    );
    await client.query(
      `INSERT INTO track_data(track_id,geometry,samples)
       VALUES($1,ST_GeomFromText('LINESTRING(-3 40,-3.01 40.01,-3.02 40)',4326),$2::jsonb)`,
      [
        id,
        JSON.stringify(
          [0, distance / 2, distance].map((distanceMeters, i) => ({
            distanceMeters,
            elevationMeters:
              coverage === "absent" || (coverage === "partial" && i === 2)
                ? null
                : i === 1
                  ? 10 + range
                  : 10,
            speedMps: null,
          })),
        ),
      ],
    );
    await client.query(
      `INSERT INTO track_directional_representations(track_id,intermediate_count,geometry,directionless_edges,version)
       SELECT $1,n,ST_MakeLine(ARRAY(SELECT ST_SetSRID(ST_MakePoint(-3-i*0.001,40+i*0.001),4326) FROM generate_series(0,n+1) i)),to_jsonb(array_fill(false,ARRAY[n+1])),1
       FROM unnest(ARRAY[0,1,3,4,5]) n`,
      [id],
    );
    for (const [ordinal, label] of (options.tags ?? ["BÓSQUE"]).entries())
      await client.query(
        "INSERT INTO track_tags(track_id,ordinal,label,normalized_key) VALUES($1,$2,$3,$4)",
        [id, ordinal, label, label.normalize("NFKC").toLowerCase()],
      );
    await client.query(
      `INSERT INTO track_upload_attempts(owner_id,request_id,fingerprint,file_id,track_id,state)
       VALUES($1,$2,$3,$4,$5,'complete')`,
      [ownerId, requestId, "c".repeat(64), fileId, id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { id, name };
}

async function explore(
  request: APIRequestContext,
  params: Record<string, string> = {},
) {
  const response = await request.get(
    `/api/tracks/explore?${new URLSearchParams(params)}`,
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  return (await response.json()) as ExploreResult;
}

test("anonymous public search and foreign collections cannot reveal private counts, bounds or geometry", async ({
  page,
  request,
}) => {
  const owner = await account();
  const visible = await track(owner);
  const beforePrivate = await explore(request, { q: marker });
  const hidden = await track(owner, {
    name: `${marker} private summit`,
    visibility: "private",
    distance: 999000,
    range: 9000,
  });
  const result = await explore(request, { q: marker });
  expect(result.tracks.map((item) => item.id)).toEqual([visible.id]);
  expect(result.total).toBe(1);
  expect(result.scopeCount).toBe(beforePrivate.scopeCount);
  expect(result.bounds).toEqual(beforePrivate.bounds);
  const collection = await explore(request, {
    ownerId: owner,
    visibility: "private",
  });
  expect(collection.tracks.map((item) => item.id)).toEqual([visible.id]);
  expect(collection).toMatchObject({
    total: 1,
    scopeCount: 1,
    bounds: { maxDistanceKm: 1.2, maxElevationRangeMeters: 40 },
    collection: { id: owner, isOwner: false },
  });
  const denied = await request.get(`/api/tracks/${hidden.id}/explore-geometry`);
  expect(denied.status()).toBe(404);
  expect(denied.headers()["cache-control"]).toContain("no-store");
  await page.goto(`/en/tracks?q=${marker}&visibility=private`);
  await expect(
    page.getByRole("link", { name: visible.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: hidden.name, exact: true }),
  ).toHaveCount(0);
  await page.goto(`/en/users/${owner}/tracks?visibility=private`);
  await expect(
    page.getByRole("link", { name: visible.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: hidden.name, exact: true }),
  ).toHaveCount(0);
});

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    const en = locale === "en";
    test(`${locale} ${theme} owners see their private collection while another signed-in account sees only public tracks`, async ({
      context,
      page,
      baseURL,
    }) => {
      const owner = await account();
      const other = await account();
      const visible = await track(owner);
      const hidden = await track(owner, {
        name: `${marker} private summit`,
        visibility: "private",
        distance: 999000,
        range: 9000,
      });
      const foreign = await track(other, {
        name: `${marker} other collection`,
      });
      const foreignPrivate = await track(other, {
        visibility: "private",
        name: `${marker} other secret`,
      });
      await signIn(context, baseURL!, owner);
      const own = await explore(context.request, { ownerId: owner });
      expect(own).toMatchObject({
        total: 2,
        scopeCount: 2,
        collection: { isOwner: true },
        bounds: { maxDistanceKm: 999, maxElevationRangeMeters: 9000 },
      });
      expect(own.tracks.map((item) => item.id)).toEqual([
        hidden.id,
        visible.id,
      ]);
      const global = await explore(context.request, { q: marker });
      expect(global.tracks.map((item) => item.id).sort()).toEqual(
        [visible.id, foreign.id].sort(),
      );
      const allowed = await context.request.get(
        `/api/tracks/${hidden.id}/explore-geometry`,
      );
      expect(allowed.status()).toBe(200);
      expect(await allowed.json()).toEqual({
        geometry: {
          type: "LineString",
          coordinates: [
            [-3, 40],
            [-3.01, 40.01],
            [-3.02, 40],
          ],
        },
      });
      await page.goto(`/${locale}/users/${owner}/tracks`);
      await selectTheme(page, theme);
      const results = page.getByRole("list", {
        name: en ? "Track results" : "Resultados de tracks",
      });
      await expect(
        page.getByRole("link", { name: hidden.name, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: foreign.name, exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: foreignPrivate.name, exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: en ? "Filters" : "Filtros", exact: true })
        .click();
      await page
        .getByRole("button", { name: en ? "Private" : "Privados", exact: true })
        .click();
      await expect(page).toHaveURL(/visibility=private/);
      await expect(
        results.getByRole("link", { name: visible.name, exact: true }),
      ).toHaveCount(0);
      await expect(
        results.getByRole("link", { name: hidden.name, exact: true }),
      ).toBeVisible();
      await signIn(context, baseURL!, other);
      await page.reload();
      await expect(
        results.getByRole("link", { name: visible.name, exact: true }),
      ).toBeVisible();
      await expect(
        results.getByRole("link", { name: hidden.name, exact: true }),
      ).toHaveCount(0);
      const guest = await explore(context.request, {
        ownerId: owner,
        visibility: "private",
      });
      expect(guest).toMatchObject({
        total: 1,
        scopeCount: 1,
        bounds: { maxDistanceKm: 1.2, maxElevationRangeMeters: 40 },
        collection: { isOwner: false },
      });
      expect(
        (
          await context.request.get(`/api/tracks/${hidden.id}/explore-geometry`)
        ).status(),
      ).toBe(404);
      await page
        .getByRole("button", { name: en ? "Filters" : "Filtros", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: en ? "Private" : "Privados",
          exact: true,
        }),
      ).toHaveCount(0);
    });
  }

  test(`${locale} missing and inactive collections are not found while active private-only collections are empty`, async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const active = await account();
    const noUploads = await account();
    const inactive = await account();
    const privateTrack = await track(active, { visibility: "private" });
    const inactiveTrack = await track(inactive, {
      name: `${marker} inactive ridge`,
    });
    await pool.query("UPDATE users SET active=false WHERE id=$1", [inactive]);
    await signIn(context, baseURL!, inactive);
    for (const id of [randomUUID(), inactive]) {
      const response = await request.get(`/api/tracks/explore?ownerId=${id}`);
      expect(response.status()).toBe(404);
      expect(response.headers()["cache-control"]).toContain("no-store");
      await page.goto(`/${locale}/users/${id}/tracks`);
      // Streaming pages can deliver the not-found UI after the HTTP shell.
      await expect(
        page.getByRole("heading", {
          name:
            locale === "en"
              ? "Collection not found"
              : "Colección no encontrada",
          exact: true,
        }),
      ).toBeVisible();
    }
    const empty = await explore(request, {
      ownerId: active,
      visibility: "private",
    });
    expect(empty).toMatchObject({
      tracks: [],
      total: 0,
      scopeCount: 0,
      bounds: { maxDistanceKm: 0, maxElevationRangeMeters: 0 },
      collection: { id: active, isOwner: false },
    });
    expect(
      (
        await context.request.get(
          `/api/tracks/${inactiveTrack.id}/explore-geometry`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.get(`/api/tracks/${privateTrack.id}/explore-geometry`)
      ).status(),
    ).toBe(404);
    expect((await explore(request, { q: marker })).total).toBe(0);
    expect((await explore(context.request, { q: marker })).total).toBe(0);
    await page.goto(`/${locale}/users/${active}/tracks?visibility=private`);
    await expect(
      page.getByText(
        locale === "en"
          ? "This collection has no tracks to show."
          : "Esta colección no tiene tracks para mostrar.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: locale === "en" ? "Clear filters" : "Borrar filtros",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.goto(`/${locale}/users/${noUploads}/tracks`);
    await expect(
      page.getByText(
        locale === "en"
          ? "This collection has no tracks to show."
          : "Esta colección no tiene tracks para mostrar.",
        { exact: true },
      ),
    ).toBeVisible();
  });
}

test("real title/tag search intersects alternative categories and inclusive unrounded measurements", async ({
  page,
  request,
}) => {
  const owner = await account();
  const exact = await track(owner);
  await track(owner, {
    name: `${marker} Peña walking`,
    activity: "walking",
    difficulty: 5,
    distance: 1200.001,
    range: 40.001,
  });
  await track(owner, { name: `${marker} Peña partial`, elevation: "partial" });
  await track(owner, { name: `${marker} Peña absent`, elevation: "absent" });
  const combined = await request.get(
    `/api/tracks/explore?ownerId=${owner}&q=${marker}+PENA+bosq&activity=hiking&activity=walking&difficulty=3&difficulty=5`,
  );
  expect(combined.status()).toBe(200);
  expect((await combined.json()).total).toBe(4);
  const differentCategories = await request.get(
    `/api/tracks/explore?ownerId=${owner}&activity=walking&difficulty=3`,
  );
  expect(differentCategories.status()).toBe(200);
  expect((await differentCategories.json()).total).toBe(0);
  const filtered = await explore(request, {
    ownerId: owner,
    q: `${marker} PENA bosq`,
    minDistance: "1.2",
    maxDistance: "1.2",
    maxElevationRange: "40",
  });
  expect(filtered.tracks.map((item) => item.id)).toEqual([exact.id]);
  expect(filtered.scopeCount).toBe(4);
  expect(filtered.bounds.maxDistanceKm).toBeCloseTo(1.200001, 12);
  expect(filtered.bounds.maxElevationRangeMeters).toBeCloseTo(40.001, 12);
  expect(
    (await explore(request, { ownerId: owner, q: "descriptiononly" })).total,
  ).toBe(0);
  expect(
    (await explore(request, { ownerId: owner, q: "pena missing" })).total,
  ).toBe(0);
  await page.goto(`/en/users/${owner}/tracks`);
  const search = page.getByRole("searchbox", {
    name: "Search titles and tags",
  });
  await search.fill("PENA bosq");
  await expect(
    page.getByText("4 matching tracks", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("button", { name: "Hiking", exact: true }).click();
  await page.getByRole("button", { name: "Difficulty 3", exact: true }).click();
  const maximum = page.getByRole("spinbutton", {
    name: "Maximum distance (km)",
    exact: true,
  });
  await maximum.fill("1.2");
  await maximum.press("Enter");
  const elevation = page.getByRole("spinbutton", {
    name: "Maximum elevation range (m)",
    exact: true,
  });
  await elevation.fill("40");
  await elevation.press("Enter");
  await expect(
    page.getByText("1 matching track", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: exact.name, exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/maxElevationRange=40/);
  await expect(
    page.getByRole("link", { name: "Español", exact: true }),
  ).toHaveAttribute("href", /maxElevationRange=40/);
  await page.reload();
  await expect(
    page.getByText("1 matching track", { exact: true }),
  ).toBeVisible();
  await search.fill("missing");
  await expect(
    page.getByText("No matching tracks", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(
    page.getByText("4 matching tracks", { exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(
    /q=|activity=|difficulty=|maxDistance=|maxElevationRange=/,
  );
});

for (const state of ["expired", "revoked"] as const) {
  test(`${state} owner sessions cannot expand HTTP collection scope or read private geometry`, async ({
    context,
    baseURL,
  }) => {
    const owner = await account();
    const visible = await track(owner);
    const hidden = await track(owner, {
      visibility: "private",
      distance: 999000,
      range: 9000,
    });
    await signIn(context, baseURL!, owner);
    expect((await explore(context.request, { ownerId: owner })).total).toBe(2);
    if (state === "expired")
      await pool.query(
        "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
        [owner],
      );
    else await pool.query("DELETE FROM sessions WHERE user_id=$1", [owner]);
    const guest = await explore(context.request, {
      ownerId: owner,
      visibility: "private",
    });
    expect(guest.tracks.map((item) => item.id)).toEqual([visible.id]);
    expect(guest).toMatchObject({
      total: 1,
      scopeCount: 1,
      bounds: { maxDistanceKm: 1.2, maxElevationRangeMeters: 40 },
      collection: { isOwner: false },
    });
    expect(
      (
        await context.request.get(`/api/tracks/${hidden.id}/explore-geometry`)
      ).status(),
    ).toBe(404);
  });
}

test("real stable ten-track pages preserve mobile List/Map state, Back and page clamping", async ({
  page,
  request,
}) => {
  const owner = await account();
  const rows = [];
  for (let i = 0; i < 12; i++)
    rows.push(
      await track(owner, {
        name: `${marker} Peña ${String(i).padStart(2, "0")}`,
        createdAt: "2026-01-01T00:00:00Z",
      }),
    );
  const newest = rows.toSorted((a, b) => b.id.localeCompare(a.id));
  const first = await explore(request, { ownerId: owner });
  const second = await explore(request, { ownerId: owner, page: "2" });
  expect(first).toMatchObject({
    total: 12,
    scopeCount: 12,
    page: 1,
    pageCount: 2,
  });
  expect(first.tracks.map((item) => item.id)).toEqual(
    newest.slice(0, 10).map((item) => item.id),
  );
  expect(second.tracks.map((item) => item.id)).toEqual(
    newest.slice(10).map((item) => item.id),
  );
  expect((await explore(request, { ownerId: owner, page: "99" })).page).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/es/users/${owner}/tracks`);
  await expect(
    page.getByText("12 tracks encontrados", { exact: true }),
  ).toBeVisible();
  const list = page.getByRole("list", { name: "Resultados de tracks" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  await page.getByRole("button", { name: "Página 2", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(list.getByRole("listitem")).toHaveCount(2);
  for (const row of newest.slice(10))
    await expect(
      list.getByRole("link", { name: row.name, exact: true }),
    ).toBeVisible();
  await page.getByRole("button", { name: "Mapa", exact: true }).click();
  await expect(page.locator("canvas.maplibregl-canvas:visible")).toHaveCount(1);
  await expect(page).toHaveURL(/page=2/);
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  await page.goBack();
  await expect(list.getByRole("listitem")).toHaveCount(10);
  await page.goForward();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("searchbox").fill(newest[0].name);
  await expect(page).not.toHaveURL(/page=/);
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(
    list.getByRole("link", { name: newest[0].name, exact: true }),
  ).toBeVisible();
  await page.goto(`/es/users/${owner}/tracks?page=99`);
  await expect(page).toHaveURL(/page=2/);
  await expect(list.getByRole("listitem")).toHaveCount(2);
});

test("returning after session revocation and logging out reauthorize private snapshots", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await account();
  const visible = await track(owner);
  const hidden = await track(owner, {
    visibility: "private",
    name: `${marker} private summit`,
  });
  await signIn(context, baseURL!, owner);
  await page.goto(`/en/users/${owner}/tracks`);
  await expect(
    page.getByRole("link", { name: hidden.name, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Explorer T.", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/settings$/);
  await pool.query("DELETE FROM sessions WHERE user_id=$1", [owner]);
  const reauthorized = page.waitForResponse(
    (response) =>
      response.url().includes("/api/tracks/explore?") &&
      response.status() === 200,
  );
  await page.goBack();
  const result = (await (await reauthorized).json()) as ExploreResult;
  expect(result.tracks.map((item) => item.id)).toEqual([visible.id]);
  await expect(
    page.getByRole("link", { name: hidden.name, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: visible.name, exact: true }),
  ).toBeVisible();
  await signIn(context, baseURL!, owner);
  await page.reload();
  await expect(
    page.getByRole("link", { name: hidden.name, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Explorer T.", exact: true }).click();
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
  await expect(
    page.getByRole("link", { name: hidden.name, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: visible.name, exact: true }),
  ).toBeVisible();
  const guest = await explore(context.request, { ownerId: owner });
  expect(guest.tracks.map((item) => item.id)).toEqual([visible.id]);
  expect(
    (
      await context.request.get(`/api/tracks/${hidden.id}/explore-geometry`)
    ).status(),
  ).toBe(404);
});

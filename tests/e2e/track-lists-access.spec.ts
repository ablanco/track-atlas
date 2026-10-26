import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
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
    throw Error("List acceptance requires a local development database");
  pool = new Pool({ connectionString: database.href });
});
test.beforeEach(async ({ page }) => {
  marker = `accept${randomBytes(6).toString("hex")}`;
  await stubBasemap(page);
});
test.afterEach(async () => {
  for (const id of owners) {
    await pool.query("DELETE FROM track_lists WHERE owner_id=$1", [id]);
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
    [`lists-access-${randomUUID()}@example.test`],
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

async function createList(
  request: APIRequestContext,
  name: string,
  trackId?: string,
) {
  const response = await request.post("/api/lists", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: { name, ...(trackId ? { trackId } : {}) },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).list as {
    id: string;
    name: string;
    trackCount: number;
  };
}
async function membership(
  page: Page,
  listId: string,
  trackId: string,
  present = true,
) {
  const status = await page.evaluate(
    async ({ listId, trackId, present }) => {
      const response = await fetch(`/api/lists/${listId}/tracks/${trackId}`, {
        method: present ? "PUT" : "DELETE",
      });
      return response.status;
    },
    { listId, trackId, present },
  );
  expect(status).toBe(204);
}

test("mixed-owner lists retain independent access, counts and bounds through visibility loss and restoration", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await account(),
    uploader = await account();
  const own = await track(owner, {
    visibility: "private",
    name: `${marker} own`,
  });
  const publicTrack = await track(uploader, {
    name: `${marker} outlier`,
    distance: 99000,
    range: 900,
  });
  await signIn(context, baseURL!, owner);
  await page.goto("/en/lists");
  const list = await createList(context.request, `${marker} Weekend`, own.id);
  // Fixture setup for independent read/access assertions; real checkbox writes
  // are exercised separately below, without mocking their responses.
  await pool.query(
    "INSERT INTO track_list_memberships(list_id,track_id) VALUES($1,$2)",
    [list.id, publicTrack.id],
  );
  const initial = await explore(context.request, { listId: list.id });
  expect(initial).toMatchObject({
    total: 2,
    scopeCount: 2,
    bounds: { maxDistanceKm: 99, maxElevationRangeMeters: 900 },
  });
  expect(initial.tracks.map((t) => t.id)).toEqual([publicTrack.id, own.id]);
  await page.goto(`/en/lists/${list.id}`);
  await expect(
    page.getByRole("link", { name: publicTrack.name, exact: true }),
  ).toBeVisible();
  for (const loss of ["private", "inactive"] as const) {
    if (loss === "private")
      await pool.query("UPDATE tracks SET visibility='private' WHERE id=$1", [
        publicTrack.id,
      ]);
    else
      await pool.query("UPDATE users SET active=false WHERE id=$1", [uploader]);
    const hidden = await explore(context.request, { listId: list.id });
    expect(hidden.tracks.map((t) => t.id)).toEqual([own.id]);
    expect(hidden).toMatchObject({
      total: 1,
      scopeCount: 1,
      bounds: { maxDistanceKm: 1.2, maxElevationRangeMeters: 40 },
    });
    expect(
      (await (await context.request.get(`/api/lists/${list.id}`)).json()).list
        .trackCount,
    ).toBe(1);
    expect(
      (
        await context.request.get(
          `/api/tracks/${publicTrack.id}/explore-geometry`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await context.request.get(`/api/tracks/${publicTrack.id}/download`)
      ).status(),
    ).toBe(404);
    await page.reload();
    await expect(
      page.getByRole("link", { name: publicTrack.name, exact: true }),
    ).toHaveCount(0);
    await page.goto(`/en/tracks/${publicTrack.id}`);
    await expect(
      page.getByRole("heading", { name: publicTrack.name, exact: true }),
    ).toHaveCount(0);
    await pool.query("UPDATE tracks SET visibility='public' WHERE id=$1", [
      publicTrack.id,
    ]);
    await pool.query("UPDATE users SET active=true WHERE id=$1", [uploader]);
    expect(
      (await explore(context.request, { listId: list.id })).tracks.map(
        (t) => t.id,
      ),
    ).toEqual([publicTrack.id, own.id]);
    await page.goto(`/en/lists/${list.id}`);
    await expect(
      page.getByRole("link", { name: publicTrack.name, exact: true }),
    ).toBeVisible();
  }
  // Permanent deletion cascades memberships; unlike access loss, it cannot restore.
  await pool.query("DELETE FROM tracks WHERE id=$1", [publicTrack.id]);
  expect((await explore(context.request, { listId: list.id })).scopeCount).toBe(
    1,
  );
  await page.reload();
  await expect(
    page.getByRole("link", { name: publicTrack.name, exact: true }),
  ).toHaveCount(0);
});

test("real checkbox saves multiple memberships across public, collection and details views", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await account();
  const saved = await track(owner);
  await signIn(context, baseURL!, owner);
  const first = await createList(context.request, `${marker} First`);
  const second = await createList(context.request, `${marker} Second`);
  await page.goto(`/en/tracks?q=${marker}`);
  const bookmark = page.getByRole("button", {
    name: "Save to lists",
    exact: true,
  });
  await expect(bookmark).toHaveAttribute("aria-pressed", "false");
  await bookmark.click();
  const checkbox = page.getByRole("checkbox", {
    name: first.name,
    exact: true,
  });
  const write = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/lists/${first.id}/tracks/${saved.id}`) &&
      r.request().method() === "PUT",
  );
  await checkbox.click();
  expect((await write).status()).toBe(204);
  await expect(checkbox).toBeChecked();
  await page.getByRole("checkbox", { name: second.name, exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: second.name, exact: true }),
  ).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(bookmark).toHaveAttribute("aria-pressed", "true");
  await membership(page, first.id, saved.id); // Retried HTTP add is idempotent.
  expect((await explore(context.request, { listId: first.id })).total).toBe(1);
  for (const destination of [
    `/en/users/${owner}/tracks`,
    `/en/tracks/${saved.id}`,
  ]) {
    await page.goto(destination);
    await expect(bookmark).toHaveAttribute("aria-pressed", "true");
    await bookmark.click();
    await expect(
      page.getByRole("checkbox", { name: first.name, exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: second.name, exact: true }),
    ).toBeChecked();
    await page.keyboard.press("Escape");
  }
  await page.goto(`/en/lists/${first.id}`);
  await bookmark.click();
  await page.getByRole("checkbox", { name: first.name, exact: true }).click();
  await expect(
    page.getByText("This list has no accessible tracks yet.", { exact: true }),
  ).toBeVisible();
  await page.goto(`/en/tracks/${saved.id}`);
  await expect(bookmark).toHaveAttribute("aria-pressed", "true"); // Second list still contains it.
  await bookmark.click();
  await page.getByRole("checkbox", { name: second.name, exact: true }).click();
  await expect(bookmark).toHaveAttribute("aria-pressed", "false");
  await membership(page, second.id, saved.id, false); // Retried remove also succeeds.
});

test("real overview and sidebar management preserve filters and delete only lists", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await account();
  const saved = await track(owner);
  await signIn(context, baseURL!, owner);
  const populated = await createList(
    context.request,
    `${marker} Weekend`,
    saved.id,
  );
  await page.goto("/en/lists");
  await expect(
    page.getByRole("link", { name: populated.name, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "List name", exact: true })
    .fill("  Empty walks  ");
  await page.getByRole("button", { name: "Create list", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Empty walks", exact: true }),
  ).toBeVisible();
  const index = await (await context.request.get("/api/lists")).json();
  expect(index.lists.map((list: { name: string }) => list.name)).toEqual([
    "Empty walks",
    populated.name,
  ]);
  expect(
    index.lists.map((list: { trackCount: number }) => list.trackCount),
  ).toEqual([0, 1]);
  const duplicate = await context.request.post("/api/lists", {
    headers: { origin: baseURL! },
    data: { name: " EMPTY WALKS " },
  });
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toEqual({ error: "duplicateName" });
  await page.goto(`/en/lists/${populated.id}?q=missing&visibility=public`);
  await expect(
    page.getByText("No matching tracks", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "List name" })
    .fill("Mountain days");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Mountain days", exact: true, level: 2 }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/en/lists/${populated.id}\\?q=missing&visibility=public$`),
  );
  expect(
    (await (await context.request.get(`/api/lists/${populated.id}`)).json())
      .list.name,
  ).toBe("Mountain days");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Tracks will not be deleted",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(
    (await context.request.get(`/api/lists/${populated.id}`)).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const deletion = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/lists/${populated.id}`) &&
      r.request().method() === "DELETE",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete list", exact: true })
    .click();
  expect((await deletion).status()).toBe(204);
  await expect(page).toHaveURL(/\/en\/lists$/);
  expect(
    (await context.request.get(`/api/lists/${populated.id}`)).status(),
  ).toBe(404);
  expect(
    (
      await context.request.get(`/api/tracks/${saved.id}/explore-geometry`)
    ).status(),
  ).toBe(200);
  await page.getByRole("link", { name: "Empty walks", exact: true }).click();
  await expect(
    page.getByText("This list has no accessible tracks yet.", { exact: true }),
  ).toBeVisible();
});

for (const state of ["guest", "foreign", "expired", "revoked"] as const) {
  test(`${state} callers cannot read or mutate private lists through HTTP or routes`, async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await account();
    const saved = await track(owner, { visibility: "private" });
    await signIn(context, baseURL!, owner);
    const list = await createList(
      context.request,
      `${marker} confidential`,
      saved.id,
    );
    if (state === "guest") await context.clearCookies();
    if (state === "foreign") await signIn(context, baseURL!, await account());
    if (state === "expired")
      await pool.query(
        "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
        [owner],
      );
    if (state === "revoked")
      await pool.query("DELETE FROM sessions WHERE user_id=$1", [owner]);
    const status = state === "foreign" ? 404 : 401;
    for (const path of [
      `/api/lists/${list.id}`,
      `/api/tracks/explore?listId=${list.id}`,
    ]) {
      const response = await context.request.get(path);
      expect(response.status()).toBe(status);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(response.headers()["x-content-type-options"]).toBe("nosniff");
      expect(await response.text()).not.toContain(list.name);
    }
    const patch = await context.request.patch(`/api/lists/${list.id}`, {
      headers: { origin: baseURL! },
      data: { name: "Stolen" },
    });
    expect(patch.status()).toBe(status);
    expect(
      (await context.request.get(`/api/lists?trackId=${saved.id}`)).status(),
    ).toBe(state === "foreign" ? 404 : 401);
    const route = `/es/lists/${list.id}?q=confidential&visibility=private`;
    const response = await page.goto(route);
    expect(response!.headers()["cache-control"]).toContain("no-store");
    expect(response!.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.getByRole("main")).not.toContainText(list.name);
    await expect(
      page.getByRole("link", { name: saved.name, exact: true }),
    ).toHaveCount(0);
    if (state === "foreign") {
      await expect(
        page.getByRole("heading", { name: "Lista no encontrada", exact: true }),
      ).toBeVisible();
      expect(
        (await context.request.get(`/api/lists/${randomUUID()}`)).status(),
      ).toBe(404);
    } else {
      await page
        .getByRole("main")
        .getByRole("button", { name: "Iniciar sesión", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
        route,
      );
    }
    await signIn(context, baseURL!, owner);
    expect(
      (await (await context.request.get(`/api/lists/${list.id}`)).json()).list
        .name,
    ).toBe(list.name);
  });
}

for (const locale of ["en", "es"] as const) {
  test(`${locale} real picker creates atomically with keyboard, theme and mobile bounds`, async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await account();
    const saved = await track(owner);
    await signIn(context, baseURL!, owner);
    const existing = await createList(context.request, `${marker} Existing`);
    if (locale === "es")
      await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${locale}/tracks?q=${marker}`);
    await selectTheme(page, locale === "en" ? "light" : "dark");
    const label = locale === "en" ? "Save to lists" : "Guardar en listas";
    const bookmark = page.getByRole("button", { name: label, exact: true });
    await expect(bookmark).toHaveAttribute("aria-pressed", "false");
    await bookmark.focus();
    await bookmark.press("Enter");
    const search = page.getByRole("searchbox", {
      name: locale === "en" ? "Search lists" : "Buscar listas",
      exact: true,
    });
    await expect(
      page.getByRole("checkbox", { name: existing.name, exact: true }),
    ).not.toBeChecked();
    await search.fill("No existing matches");
    await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(0);
    const name = `${marker} Created ${locale}`;
    const input = page.getByRole("textbox", {
      name: locale === "en" ? "List name" : "Nombre de la lista",
      exact: true,
    });
    await input.fill(name);
    await input.press("Enter");
    await expect(bookmark).toHaveAttribute("aria-pressed", "true");
    await search.fill("");
    await expect(
      page.getByRole("checkbox", { name, exact: true }),
    ).toBeChecked();
    const picker = await (
      await context.request.get(`/api/lists?trackId=${saved.id}`)
    ).json();
    expect(
      picker.lists.map(
        (list: {
          name: string;
          containsTrack: boolean;
          trackCount: number;
        }) => ({
          name: list.name,
          containsTrack: list.containsTrack,
          trackCount: list.trackCount,
        }),
      ),
    ).toEqual([
      { name, containsTrack: true, trackCount: 1 },
      { name: existing.name, containsTrack: false, trackCount: 0 },
    ]);
    const box = await page
      .getByRole("dialog", { name: label, exact: true })
      .boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(0);
    await expect(bookmark).toBeFocused();
    await bookmark.press("Enter");
    await expect(
      page.getByRole("checkbox", { name, exact: true }),
    ).toBeChecked();
    // The taller explorer toolbar may place the picker over the search input.
    // Click inert outside padding, which stays outside the popup's collision inset.
    await page.locator("#main-content").click({ position: { x: 2, y: 2 } });
    await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(0);
    expect(
      (await explore(context.request, { q: marker })).tracks[0].isBookmarked,
    ).toBe(true);
    await page.reload();
    await expect(bookmark).toHaveAttribute("aria-pressed", "true");
  });
}

test("list order, mixed visibility filters and ten-track history pagination use retained membership order", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await account(),
    uploader = await account();
  await signIn(context, baseURL!, owner);
  const list = await createList(context.request, `${marker} Ordered`);
  const rows = [];
  for (let i = 0; i < 11; i++) {
    const row = await track(i === 0 ? owner : uploader, {
      name: `${marker} route-${String(i).padStart(2, "0")}`,
      visibility: i === 0 ? "private" : "public",
    });
    rows.push(row);
    await pool.query(
      "INSERT INTO track_list_memberships(list_id,track_id,created_at) VALUES($1,$2,$3)",
      [list.id, row.id, new Date(Date.UTC(2026, 0, 1, 0, i))],
    );
  }
  expect(
    (await explore(context.request, { listId: list.id })).tracks.map(
      (t) => t.id,
    ),
  ).toEqual(
    rows
      .slice(1)
      .reverse()
      .map((t) => t.id),
  );
  expect(
    await explore(context.request, { listId: list.id, page: "99" }),
  ).toMatchObject({ total: 11, scopeCount: 11, page: 2, pageCount: 2 });
  expect(
    (
      await explore(context.request, { listId: list.id, visibility: "private" })
    ).tracks.map((t) => t.id),
  ).toEqual([rows[0].id]);
  expect(
    (await explore(context.request, { listId: list.id, visibility: "public" }))
      .total,
  ).toBe(10);
  await page.goto(`/en/lists/${list.id}`);
  const results = page.getByRole("list", {
    name: "Track results",
    exact: true,
  });
  await expect(results.getByRole("listitem")).toHaveCount(10);
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(
    results.getByRole("link", { name: rows[0].name, exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/page=2/);
  // Repeated restoration also exercises the controls while result requests and
  // viewport callbacks from the previous page are still settling.
  for (let n = 0; n < 12; n++) {
    await page.goBack();
    await expect(results.getByRole("listitem")).toHaveCount(10);
    await page.goForward();
    await expect(results.getByRole("listitem")).toHaveCount(1);
  }
  await page.goBack();
  await expect(results.getByRole("listitem")).toHaveCount(10);
  await page.goForward();
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await page
    .getByRole("searchbox", { name: "Search titles and tags", exact: true })
    .fill("route-10");
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(page).not.toHaveURL(/page=/);
  await expect(
    results.getByRole("link", { name: rows[10].name, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Visibility", exact: true })
    .getByRole("button", { name: "Private", exact: true })
    .click();
  await expect(
    page.getByText("No matching tracks", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/visibility=private/);
  // A real uncheck on the last page must refresh and clamp without confirmation.
  await page.goto(`/en/lists/${list.id}?page=2`);
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Save to lists", exact: true })
    .click();
  await page.getByRole("checkbox", { name: list.name, exact: true }).click();
  await expect(results.getByRole("listitem")).toHaveCount(10);
  await expect(page).not.toHaveURL(/page=/);
  expect(await explore(context.request, { listId: list.id })).toMatchObject({
    total: 10,
    scopeCount: 10,
    pageCount: 1,
  });
  await membership(page, list.id, rows[0].id);
  expect(
    (await explore(context.request, { listId: list.id })).tracks[0].id,
  ).toBe(rows[0].id);
});

for (const ending of ["logout", "revocation"] as const) {
  test(`${ending} followed by Back clears private list metadata and tracks`, async ({
    page,
    context,
    baseURL,
  }) => {
    const owner = await account();
    const saved = await track(owner, {
      visibility: "private",
      name: `${marker} secret summit`,
    });
    await signIn(context, baseURL!, owner);
    const list = await createList(
      context.request,
      `${marker} private plans`,
      saved.id,
    );
    await page.goto(`/en/lists/${list.id}`);
    await expect(
      page.getByRole("link", { name: saved.name, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Explorer T.", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/settings$/);
    if (ending === "revocation")
      await pool.query("DELETE FROM sessions WHERE user_id=$1", [owner]);
    else {
      await page
        .getByRole("banner")
        .getByRole("button", { name: "Explorer T.", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Log out", exact: true })
        .click();
      await expect(
        page
          .getByRole("banner")
          .getByRole("button", { name: "Log in", exact: true }),
      ).toBeVisible();
    }
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/en/lists/${list.id}$`));
    await expect(page.getByRole("main")).toContainText("Log in to view");
    await expect(page.getByRole("main")).not.toContainText(list.name);
    await expect(
      page.getByRole("link", { name: saved.name, exact: true }),
    ).toHaveCount(0);
    expect((await context.request.get(`/api/lists/${list.id}`)).status()).toBe(
      401,
    );
    expect(
      (
        await context.request.get(`/api/tracks/${saved.id}/explore-geometry`)
      ).status(),
    ).toBe(404);
    await page.goto("/en/lists");
    await expect(page.getByRole("main")).toContainText("Log in to view");
    await expect(page.getByRole("main")).not.toContainText(list.name);
  });
}

test("My lists uses twenty-list pages and enforces validation and the real list limit", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await account();
  await signIn(context, baseURL!, owner);
  const names = Array.from(
    { length: 21 },
    (_, i) => `${marker} Plan ${String(i).padStart(2, "0")}`,
  );
  // Committed, uniquely owned fixtures; timestamps make expected order explicit.
  for (const [i, name] of names.entries())
    await pool.query(
      "INSERT INTO track_lists(owner_id,name,normalized_name,created_at) VALUES($1,$2,$3,$4)",
      [owner, name, name.toLowerCase(), new Date(Date.UTC(2026, 0, 1, 0, i))],
    );
  const first = await (await context.request.get("/api/lists")).json();
  expect(first).toMatchObject({ total: 21, page: 1, pageCount: 2 });
  expect(first.lists.map((list: { name: string }) => list.name)).toEqual(
    names.slice(1).reverse(),
  );
  const last = await (await context.request.get("/api/lists?page=99")).json();
  expect(last).toMatchObject({ page: 2, pageCount: 2 });
  expect(last.lists.map((list: { name: string }) => list.name)).toEqual([
    names[0],
  ]);
  await page.goto("/en/lists");
  await expect(page.getByRole("listitem")).toHaveCount(20);
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: names[0], exact: true }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  for (const name of ["", " ".repeat(3), "x".repeat(101)]) {
    const invalid = await context.request.post("/api/lists", {
      headers: { origin: baseURL! },
      data: { name },
    });
    expect(invalid.status()).toBe(400);
  }
  const inaccessible = await track(await account(), { visibility: "private" });
  const atomic = await context.request.post("/api/lists", {
    headers: { origin: baseURL! },
    data: { name: "Must not be created", trackId: inaccessible.id },
  });
  expect(atomic.status()).toBe(404);
  expect((await (await context.request.get("/api/lists")).json()).total).toBe(
    21,
  );
  await pool.query(
    `INSERT INTO track_lists(owner_id,name,normalized_name) SELECT $1,'Capacity ' || n,'capacity ' || n FROM generate_series(1,79) n`,
    [owner],
  );
  const capacity = await context.request.post("/api/lists", {
    headers: { origin: baseURL! },
    data: { name: "One too many" },
  });
  expect(capacity.status()).toBe(409);
  expect(await capacity.json()).toEqual({ error: "listLimit" });
  expect((await (await context.request.get("/api/lists")).json()).total).toBe(
    100,
  );
});

test("guest bookmark preserves its destination and sign-in never auto-saves the track", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await account();
  const saved = await track(owner);
  await signIn(context, baseURL!, owner);
  const list = await createList(context.request, `${marker} Unsaved`);
  await context.clearCookies();
  const destination = `/es/tracks?q=${marker}&difficulty=3`;
  await page.goto(destination);
  const bookmark = page.getByRole("button", {
    name: "Guardar en listas",
    exact: true,
  });
  await bookmark.click();
  await expect(
    page.getByRole("dialog", { name: "Te damos la bienvenida", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
    destination,
  );
  // Real credential + ALTCHA submission is covered by login.spec.ts's
  // "bookmark login preserves..." case. Seed the resulting genuine session here
  // to verify persisted list state with real APIs rather than mocked responses.
  await signIn(context, baseURL!, owner);
  await page.reload();
  await expect(bookmark).toHaveAttribute("aria-pressed", "false");
  await bookmark.click();
  await expect(
    page.getByRole("checkbox", { name: list.name, exact: true }),
  ).not.toBeChecked();
  expect((await explore(context.request, { listId: list.id })).total).toBe(0);
  expect(
    (await (await context.request.get(`/api/lists?trackId=${saved.id}`)).json())
      .lists[0].containsTrack,
  ).toBe(false);
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
    destination,
  );
});

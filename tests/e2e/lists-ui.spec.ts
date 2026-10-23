import { test, expect, selectTheme } from "./fixtures";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { stubBasemap } from "../helpers/map";

const trackId = "10000000-0000-4000-8000-000000000001";
const listId = "20000000-0000-4000-8000-000000000001";
const summary = {
  id: listId,
  name: "Weekend",
  trackCount: 1,
  createdAt: "2026-01-01T00:00:00Z",
};
async function explorer(page: import("@playwright/test").Page) {
  await stubBasemap(page);
  await page.route("**/explore-geometry", (route) => route.abort());
  await page.route("**/api/tracks/explore?*", (route) =>
    route.fulfill({
      json: {
        tracks: [
          {
            id: trackId,
            name: "Coastal walk",
            activity: "walking",
            difficulty: 2,
            distanceMeters: 1200,
            visibility: "public",
            owner: { id: listId, name: "Walker", avatarUrl: null },
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
}

test("guest bookmark opens the existing login modal without losing locale, path or filters", async ({
  page,
}) => {
  await explorer(page);
  await page.route("**/api/lists?*", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.goto("/es/tracks?q=costa&difficulty=2");
  await page.getByRole("button", { name: "Guardar en listas" }).click();
  await expect(
    page.getByRole("dialog", { name: "Te damos la bienvenida" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/es\/tracks\?q=costa&difficulty=2$/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("picker saves each membership, keeps failed changes unchecked, and stays open for more choices", async ({
  page,
}) => {
  await explorer(page);
  let contains = false;
  let fail = true;
  await page.route("**/api/lists?*", (route) =>
    route.fulfill({
      json: { lists: [{ ...summary, containsTrack: contains }] },
    }),
  );
  await page.route(`**/api/lists/${listId}/tracks/${trackId}`, (route) => {
    if (fail) {
      fail = false;
      return route.fulfill({ status: 409, json: { error: "trackLimit" } });
    }
    contains = route.request().method() === "PUT";
    return route.fulfill({ status: 204 });
  });
  await page.goto("/en/tracks");
  const bookmark = page.getByRole("button", { name: "Save to lists" });
  await bookmark.click();
  const checkbox = page.getByRole("checkbox", { name: /Weekend/ });
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "1,000",
  );
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(bookmark).toHaveAttribute("aria-pressed", "true");
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await expect(bookmark).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(checkbox).not.toBeVisible();
});

test("picker search keeps atomic create available and preserves the name on duplicate failure", async ({
  page,
}) => {
  await explorer(page);
  await page.route("**/api/lists?*", (route) =>
    route.fulfill({ json: { lists: [{ ...summary, containsTrack: false }] } }),
  );
  let fail = true;
  await page.route("**/api/lists", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      name: "New adventures",
      trackId,
    });
    if (fail) {
      fail = false;
      return route.fulfill({ status: 409, json: { error: "duplicateName" } });
    }
    return route.fulfill({
      status: 201,
      json: {
        list: {
          ...summary,
          id: "30000000-0000-4000-8000-000000000001",
          name: "New adventures",
        },
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/tracks");
  await page.getByRole("button", { name: "Save to lists" }).click();
  await page
    .getByRole("searchbox", { name: "Search lists" })
    .fill("nothing matches");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("textbox", { name: "List name" }).fill("New adventures");
  await page.getByRole("button", { name: "Create list", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "already have",
  );
  await expect(page.getByRole("textbox", { name: "List name" })).toHaveValue(
    "New adventures",
  );
  await page.getByRole("button", { name: "Create list", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save to lists" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("searchbox", { name: "Search lists" }).fill("");
  await expect(
    page.getByRole("checkbox", { name: "New adventures" }),
  ).toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

loadEnvConfig(process.cwd(), true);
const owners = new Set<string>();
let pool: Pool;
test.beforeAll(() => {
  const database = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
  )
    throw Error("Local development database required");
  pool = new Pool({ connectionString: database.href });
});
test.afterEach(async () => {
  for (const id of owners) {
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
    owners.delete(id);
  }
});
test.afterAll(async () => pool.end());
async function signIn(
  context: import("@playwright/test").BrowserContext,
  baseURL: string,
) {
  const id = randomUUID();
  owners.add(id);
  await pool.query(
    "INSERT INTO users(id,first_name,last_name,email,password_hash,date_of_birth) VALUES($1,'List','Tester',$2,'synthetic','1990-01-01')",
    [id, `lists-ui-${id}@example.test`],
  );
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
    [id, createHash("sha256").update(token).digest("hex")],
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
  return id;
}

test("My lists creates empty lists, renames inline and confirms deletion without deleting tracks", async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!);
  let lists = [summary];
  await page.route("**/api/lists?*", (route) =>
    route.fulfill({
      json: { lists, total: lists.length, page: 1, pageCount: 1 },
    }),
  );
  await page.route("**/api/lists", (route) => {
    lists = [
      {
        ...summary,
        id: "30000000-0000-4000-8000-000000000001",
        name: route.request().postDataJSON().name,
        trackCount: 0,
      },
      ...lists,
    ];
    return route.fulfill({ status: 201, json: { list: lists[0] } });
  });
  await page.route(`**/api/lists/${listId}`, (route) => {
    if (route.request().method() === "PATCH") {
      lists = lists.map((list) =>
        list.id === listId
          ? { ...list, name: route.request().postDataJSON().name }
          : list,
      );
      return route.fulfill({
        json: { list: lists.find((list) => list.id === listId) },
      });
    }
    lists = lists.filter((list) => list.id !== listId);
    return route.fulfill({ status: 204 });
  });
  await page.goto("/en/lists");
  await expect(
    page.getByRole("link", { name: "Weekend", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "List name", exact: true })
    .fill("Empty list");
  await page.getByRole("button", { name: "Create list", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Empty list", exact: true }),
  ).toBeVisible();
  const entry = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: "Weekend", exact: true }) });
  await entry.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "List name" })
    .fill("Mountain days");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Mountain days", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("listitem")
    .filter({
      has: page.getByRole("link", { name: "Mountain days", exact: true }),
    })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Tracks will not be deleted",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete list", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Mountain days", exact: true }),
  ).toHaveCount(0);
});

for (const locale of ["en", "es"])
  test(`${locale} private list routes prompt in place and prevent caching, indexing and referrers`, async ({
    page,
  }) => {
    const response = await page.goto(
      `/${locale}/lists/${listId}?q=forest&visibility=private`,
    );
    expect(response!.headers()["cache-control"]).toContain("no-store");
    expect(response!.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response!.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await page
      .getByRole("main")
      .getByRole("button", {
        name: locale === "en" ? "Log in" : "Iniciar sesión",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`/${locale}/lists/${listId}\\?q=forest&visibility=private$`),
    );
  });

test("restored My lists clears private metadata and asks for login when the session has expired", async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!);
  let expired = false;
  await page.route("**/api/lists?*", (route) =>
    expired
      ? route.fulfill({ status: 401, json: { error: "unauthorized" } })
      : route.fulfill({
          json: { lists: [summary], total: 1, page: 1, pageCount: 1 },
        }),
  );
  await page.goto("/en/lists");
  await expect(
    page.getByRole("link", { name: "Weekend", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Explore tracks", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/en\/tracks$/);
  expired = true;
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/lists$/);
  await expect(
    page.getByRole("link", { name: "Weekend", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("Log in to view");
});

test("restoring a browser page discards an open private picker before reauthorization", async ({
  page,
}) => {
  await explorer(page);
  let expired = false;
  await page.route("**/api/lists?*", (route) =>
    expired
      ? route.fulfill({ status: 401, json: { error: "unauthorized" } })
      : route.fulfill({
          json: { lists: [{ ...summary, containsTrack: true }] },
        }),
  );
  await page.goto("/en/tracks");
  const bookmark = page.getByRole("button", {
    name: "Save to lists",
    exact: true,
  });
  await bookmark.click();
  await expect(page.getByRole("checkbox", { name: "Weekend" })).toBeChecked();
  expired = true;
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await expect(page.getByRole("checkbox", { name: "Weekend" })).toHaveCount(0);
  await expect(bookmark).toHaveAttribute("aria-pressed", "false");
  await bookmark.click();
  await expect(
    page.getByRole("dialog", { name: "Welcome back" }),
  ).toBeVisible();
});

test("picker serializes create and checkbox saves while retaining server-confirmed membership", async ({
  page,
}) => {
  await explorer(page);
  await page.route("**/api/lists?*", (route) =>
    route.fulfill({ json: { lists: [{ ...summary, containsTrack: false }] } }),
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/lists", async (route) => {
    await pending;
    await route.fulfill({
      status: 201,
      json: {
        list: {
          ...summary,
          id: "30000000-0000-4000-8000-000000000001",
          name: "New list",
        },
      },
    });
  });
  await page.goto("/en/tracks");
  await page
    .getByRole("button", { name: "Save to lists", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "List name", exact: true })
    .fill("New list");
  await page.getByRole("button", { name: "Create list", exact: true }).click();
  try {
    await expect(
      page.getByRole("checkbox", { name: "Weekend", exact: true }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(
    page.getByRole("checkbox", { name: "New list", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Weekend", exact: true }),
  ).toBeEnabled();
});

test("list explorer removes membership and refreshes count, empty state and clamped page without losing filters", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await signIn(context, baseURL!);
  const id = randomUUID();
  await pool.query(
    "INSERT INTO track_lists(id,owner_id,name,normalized_name) VALUES($1,$2,'Weekend','weekend')",
    [id, owner],
  );
  await explorer(page);
  let removed = false;
  await page.route("**/api/tracks/explore?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get("listId")).toBe(id);
    expect(params.get("q")).toBe("coast");
    return route.fulfill({
      json: {
        tracks: removed
          ? []
          : [
              {
                id: trackId,
                name: "Coastal walk",
                activity: "walking",
                difficulty: 2,
                distanceMeters: 1200,
                visibility: "public",
                isBookmarked: true,
                owner: { id: listId, name: "Walker", avatarUrl: null },
              },
            ],
        total: removed ? 0 : 21,
        page: removed ? 1 : 3,
        pageCount: removed ? 1 : 3,
        scopeCount: removed ? 0 : 21,
        bounds: {
          maxDistanceKm: removed ? 1 : 20,
          maxElevationRangeMeters: removed ? 1 : 500,
        },
        collection: null,
        list: { id, name: "Weekend" },
      },
    });
  });
  await page.route("**/api/lists?*", (route) =>
    route.fulfill({
      json: { lists: [{ ...summary, id, containsTrack: true }] },
    }),
  );
  await page.route(`**/api/lists/${id}/tracks/${trackId}`, (route) => {
    expect(route.request().method()).toBe("DELETE");
    removed = true;
    return route.fulfill({ status: 204 });
  });
  await page.goto(`/en/lists/${id}?q=coast&visibility=public&page=3`);
  await expect(
    page.getByRole("link", { name: "My lists", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Visibility", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save to lists", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "Weekend", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Coastal walk", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("This list has no accessible tracks yet.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/en/lists/${id}\\?q=coast&visibility=public$`),
  );
});

for (const locale of ["en", "es"])
  for (const theme of ["light", "dark"] as const)
    test(`${locale} ${theme} picker supports mobile bounds, keyboard saves and dismissal`, async ({
      page,
    }) => {
      await explorer(page);
      await page.route("**/api/lists?*", (route) =>
        route.fulfill({
          json: { lists: [{ ...summary, containsTrack: false }] },
        }),
      );
      await page.route(`**/api/lists/${listId}/tracks/${trackId}`, (route) =>
        route.fulfill({ status: 204 }),
      );
      if (locale === "es")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}/tracks`);
      await selectTheme(page, theme);
      const bookmark = page.getByRole("button", {
        name: locale === "en" ? "Save to lists" : "Guardar en listas",
        exact: true,
      });
      await bookmark.focus();
      await bookmark.press("Enter");
      const search = page.getByRole("searchbox", {
        name: locale === "en" ? "Search lists" : "Buscar listas",
        exact: true,
      });
      await expect(search).toBeVisible();
      await search.focus();
      await page.keyboard.press("Tab");
      const checkbox = page.getByRole("checkbox", {
        name: "Weekend",
        exact: true,
      });
      await expect(checkbox).toBeFocused();
      await page.keyboard.press("Space");
      await expect(checkbox).toBeChecked();
      const box = await page
        .getByRole("dialog", {
          name: locale === "en" ? "Save to lists" : "Guardar en listas",
          exact: true,
        })
        .boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        page.viewportSize()!.width,
      );
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(
        page.viewportSize()!.height,
      );
      await page.keyboard.press("Escape");
      await expect(checkbox).not.toBeVisible();
      await expect(bookmark).toBeFocused();
      await bookmark.click();
      await expect(checkbox).toBeVisible();
      await page
        .getByRole("searchbox", {
          name:
            locale === "en"
              ? "Search titles and tags"
              : "Buscar títulos y etiquetas",
          exact: true,
        })
        .click();
      await expect(checkbox).not.toBeVisible();
    });

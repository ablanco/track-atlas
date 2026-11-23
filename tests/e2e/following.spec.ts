import { test, expect } from "./fixtures";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { cleanupTrackOwners } from "../helpers/track-fixture-cleanup";
import { stubBasemap } from "../helpers/map";
import { acceptFixtureDocuments } from "../helpers/legal-evidence";
loadEnvConfig(process.cwd(), true);
const url = new URL(process.env.DATABASE_URL!);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  !url.pathname.startsWith("/track_atlas_follow_")
)
  throw Error("Task-owned loopback database required");
const pool = new Pool({ connectionString: url.href });
const accounts = new Set<string>();
test.afterEach(async () => {
  await cleanupTrackOwners(pool, accounts);
  accounts.clear();
});
test.setTimeout(90000);
test.afterAll(() => pool.end());
async function account(name = "Follower", active = true) {
  const id = randomUUID();
  accounts.add(id);
  await pool.query(
    "INSERT INTO users(id,first_name,last_name,email,password_hash,date_of_birth,active,display_name) VALUES($1,$2,'Tester',$3,'synthetic','1990-01-01',$4,$2)",
    [id, name, `${id}@example.test`, active],
  );
  return id;
}
async function session(
  context: import("@playwright/test").BrowserContext,
  baseURL: string,
  id: string,
) {
  await acceptFixtureDocuments(pool, id);
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
}
test("private Following lists safe identities and removes only after a successful persisted change", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await account();
  const uploader = await account("Mountain Walker");
  const inactive = await account("Hidden Name", false);
  await pool.query(
    "INSERT INTO uploader_follows(follower_id,uploader_id) VALUES($1,$2),($1,$3)",
    [owner, uploader, inactive],
  );
  await session(context, baseURL!, owner);
  const response = await page.goto("/en/following");
  expect(response!.headers()["cache-control"]).toContain("no-store");
  await expect(
    page.getByRole("heading", { name: "Following", exact: true }),
  ).toBeVisible();
  const row = page.getByRole("listitem").filter({
    has: page.getByRole("link", { name: "Mountain Walker", exact: true }),
  });
  await expect(row).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Hidden Name");
  await expect(page.getByRole("main")).toContainText("Inactive account");
  await page.route(`**/api/users/${uploader}/follow`, (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await row.getByRole("button", { name: "Unfollow", exact: true }).click();
  await expect(row).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await page.unroute(`**/api/users/${uploader}/follow`);
  await row.getByRole("button", { name: "Unfollow", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(row).toHaveCount(0);
  const isolated = await account("Other");
  await session(context, baseURL!, isolated);
  await page.reload();
  await expect(page.getByRole("main")).toContainText(
    "You are not following anyone yet.",
  );
});

test("digest settings persist independently and retain failed edits", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await account();
  await session(context, baseURL!, owner);
  await page.goto("/en/settings");
  const form = page.getByRole("form", {
    name: "Daily track digest",
    exact: true,
  });
  await expect(form.getByRole("switch")).toBeChecked();
  await form.getByRole("switch").click();
  await page.route("**/api/digest-preferences", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { error: "unavailable" } })
      : route.continue(),
  );
  await form
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(form.getByRole("switch")).not.toBeChecked();
  await page.unroute("**/api/digest-preferences");
  await form.getByRole("combobox").click();
  await page.getByRole("option", { name: "Deutsch", exact: true }).click();
  await form
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(form.getByRole("status")).toContainText("Preferences saved");
  await page.reload();
  await expect(form.getByRole("switch")).not.toBeChecked();
  await expect(form.getByRole("combobox")).toContainText("Deutsch");
  const discussion = await context.request.get("/api/discussion-preferences");
  expect((await discussion.json()).enabled).toBe(true);
});

async function publish(
  context: import("@playwright/test").BrowserContext,
  baseURL: string,
) {
  const uploader = await account("Uploader");
  await session(context, baseURL, uploader);
  await pool.query("UPDATE users SET email_confirmed=true WHERE id=$1", [
    uploader,
  ]);
  const trk =
    '<trk><trkseg><trkpt lat="40" lon="-3"/><trkpt lat="40.001" lon="-3.001"/></trkseg></trk>';
  const response = await context.request.post("/api/tracks", {
    headers: { origin: baseURL },
    multipart: {
      name: "Ridge",
      description: "Public ridge",
      activity: "hiking",
      difficulty: "3",
      tags: "[]",
      visibility: "public",
      requestId: randomUUID(),
      file: {
        name: "ridge.gpx",
        mimeType: "application/gpx+xml",
        buffer: Buffer.from(
          `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test">${trk}${trk}</gpx>`,
        ),
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const result = await response.json();
  return { uploader, ids: result.ids as string[] };
}
test("details follow uses guest sign-in, hides for owner, persists across tracks and refreshes history/session", async ({
  page,
  context,
  baseURL,
}) => {
  await stubBasemap(page);
  const { uploader, ids } = await publish(context, baseURL!);
  await page.goto(`/en/tracks/${ids[0]}`);
  await expect(
    page.getByRole("button", { name: "Follow", exact: true }),
  ).toHaveCount(0);
  await context.clearCookies();
  await page.reload();
  const confirmation = page.getByText(
    "You can follow before confirming your email. Delivery waits until your email is confirmed.",
    { exact: true },
  );
  await expect(confirmation).toHaveCount(0);
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const follower = await account();
  await session(context, baseURL!, follower);
  await page.reload();
  await expect(confirmation).toBeVisible();
  await context.request.put("/api/digest-preferences", {
    headers: { origin: baseURL! },
    data: { enabled: false, locale: "de" },
  });
  const follow = page.getByRole("button", { name: "Follow", exact: true });
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await follow.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Following", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await (await context.request.get("/api/digest-preferences")).json(),
  ).toEqual({ enabled: false, locale: "de" });
  await page.goto("/en/following");
  await expect(confirmation).toBeVisible();
  await pool.query("UPDATE users SET email_confirmed=true WHERE id=$1", [
    follower,
  ]);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Uploader", exact: true }),
  ).toBeVisible();
  await expect(confirmation).toHaveCount(0);
  await page.goto(`/en/tracks/${ids[1]}`);
  await expect(
    page.getByRole("button", { name: "Following", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(confirmation).toHaveCount(0);
  const state = await context.request.get(`/api/users/${uploader}/follow`);
  expect((await state.json()).following).toBe(true);
  await context.request.put(`/api/users/${uploader}/follow`, {
    headers: { origin: baseURL! },
    data: { following: false },
  });
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await pool.query("DELETE FROM sessions WHERE user_id=$1", [follower]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(follow).toBeEnabled();
  await follow.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("complete pagination clamps after last-row unfollow and reauthorizes history", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await account();
  await session(context, baseURL!, owner);
  for (let n = 0; n < 26; n++) {
    const id = await account(`Walker ${n}`);
    await pool.query(
      "INSERT INTO uploader_follows(follower_id,uploader_id) VALUES($1,$2)",
      [owner, id],
    );
  }
  await page.goto("/en/following");
  const main = page.getByRole("main");
  const list = main.getByRole("list", { name: "Following", exact: true });
  const pagination = main.getByRole("navigation", { name: "Following pages" });
  await expect(list.getByRole("listitem")).toHaveCount(25);
  await expect(
    pagination.getByRole("link", { name: "Previous" }),
  ).toBeDisabled();
  await expect(
    pagination.getByRole("link", { name: "Page 1 of 2" }),
  ).toHaveAttribute("aria-current", "page");
  await pagination.getByRole("link", { name: "Next", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(pagination.getByRole("link", { name: "Next" })).toBeDisabled();
  await expect(page).toHaveURL(/page=2/);
  await main.getByRole("button", { name: "Unfollow", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(25);
  await expect(main.getByRole("status")).toContainText("Page 1 of 1");
  await expect(page).toHaveURL(/page=1/);
  await page
    .getByRole("link", { name: "Digest settings", exact: true })
    .click();
  await expect(page).toHaveURL(/\/en\/settings$/);
  await expect(
    page.getByRole("form", { name: "Daily track digest", exact: true }),
  ).toBeVisible();
  await context.clearCookies();
  expect((await context.request.get("/api/following")).status()).toBe(401);
  await page.goBack();
  await expect(list.getByRole("listitem")).toHaveCount(0);
});

for (const locale of ["en", "es", "fr", "pt", "de", "it"]) {
  test(`${locale} following and digest controls support both themes, keyboard and hydration`, async ({
    page,
    context,
    baseURL,
  }) => {
    const { readFile } = await import("node:fs/promises");
    const messages = JSON.parse(
      await readFile(`messages/${locale}.json`, "utf8"),
    );
    const f = messages.Following,
      d = messages.DigestPreferences;
    const { uploader, ids } = await publish(context, baseURL!);
    const owner = await account();
    await session(context, baseURL!, owner);
    await stubBasemap(page);
    for (const theme of ["light", "dark"] as const) {
      await page.goto(`/${locale}/tracks/${ids[0]}`);
      const { selectTheme } = await import("./fixtures");
      await selectTheme(page, theme);
      const follow = page.getByRole("button", { name: f.follow, exact: true });
      await expect(follow).toBeEnabled();
      await follow.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("button", { name: f.following, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Follower", exact: true }).click();
      await page.getByRole("menuitem", { name: f.title, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/following$`));
      await expect(
        page.getByRole("heading", { name: f.title, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Uploader", exact: true }),
      ).toHaveAttribute("href", `/${locale}/users/${uploader}/tracks`);
      const unfollow = page
        .getByRole("main")
        .getByRole("button", { name: f.unfollow, exact: true });
      await unfollow.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("main")).toContainText(f.empty);
      await page.getByRole("link", { name: f.settings, exact: true }).click();
      const form = page.getByRole("form", { name: d.title, exact: true });
      const toggle = form.getByRole("switch");
      await expect(toggle).toBeEnabled();
      await toggle.focus();
      await page.keyboard.press("Space");
      await form.getByRole("button", { name: d.submit, exact: true }).click();
      await expect(form.getByRole("status")).toHaveText(d.saved);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  });
}

test("details pending and failed follow/unfollow retain the last confirmed state", async ({
  page,
  context,
  baseURL,
}) => {
  const { uploader, ids } = await publish(context, baseURL!);
  const follower = await account();
  await session(context, baseURL!, follower);
  await stubBasemap(page);
  await page.goto(`/en/tracks/${ids[0]}`);
  const releases: (() => void)[] = [];
  let failed = true;
  await page.route(`**/api/users/${uploader}/follow`, async (route) => {
    if (route.request().method() === "GET") return route.continue();
    if (failed) {
      await new Promise<void>((resolve) => releases.push(resolve));
      return route.fulfill({ status: 503, json: { error: "unavailable" } });
    }
    return route.continue();
  });
  const follow = page.getByRole("button", { name: "Follow", exact: true });
  await expect(follow).toBeEnabled();
  await follow.click();
  try {
    await expect.poll(() => releases.length).toBe(1);
    await expect(
      page.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
  } finally {
    releases[0]?.();
  }
  await expect(
    page
      .getByRole("main")
      .getByRole("alert")
      .filter({ hasText: "could not be changed" }),
  ).toBeVisible();
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  failed = false;
  await follow.click();
  const following = page.getByRole("button", {
    name: "Following",
    exact: true,
  });
  await expect(following).toHaveAttribute("aria-pressed", "true");
  failed = true;
  await following.click();
  try {
    await expect.poll(() => releases.length).toBe(2);
    await expect(
      page.getByRole("button", { name: "Saving…", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    releases[1]?.();
  }
  await expect(following).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(following).toHaveAttribute("aria-pressed", "true");
});

test("guest signs in through the real widget and follows without leaving track details", async ({
  page,
  context,
  baseURL,
}) => {
  const { ids } = await publish(context, baseURL!);
  const follower = await account("Signed in follower");
  const { scryptSync } = await import("node:crypto");
  const salt = randomBytes(16);
  const hash = `$scrypt$v=1$N=32768,r=8,p=3$${salt.toString("base64url")}$${scryptSync(" test password ", salt, 64, { N: 32768, r: 8, p: 3, maxmem: 67108864 }).toString("base64url")}`;
  await pool.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
    follower,
    hash,
  ]);
  await acceptFixtureDocuments(pool, follower);
  await context.clearCookies();
  await stubBasemap(page);
  await page.goto(`/es/tracks/${ids[0]}`);
  await page.getByRole("button", { name: "Seguir", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('[name="email"]').fill(`${follower}@example.test`);
  await dialog.locator('[name="password"]').fill(" test password ");
  const { solveCaptcha } = await import("./captcha-helpers");
  const proof = await solveCaptcha(page, dialog);
  try {
    await dialog
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/es/tracks/${ids[0]}$`));
    const follow = page.getByRole("button", { name: "Seguir", exact: true });
    await expect(follow).toBeEnabled();
    await follow.click();
    await expect(
      page.getByRole("button", { name: "Siguiendo", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    await pool.query("DELETE FROM captcha_uses WHERE challenge_hash=$1", [
      proof,
    ]);
  }
});

test("private page redirects guests and gates sessions awaiting legal acceptance", async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto("/fr/following");
  await expect(page).toHaveURL(/\/fr$/);
  const id = await account();
  await session(context, baseURL!, id);
  await pool.query("DELETE FROM legal_acceptances WHERE user_id=$1", [id]);
  await page.goto("/fr/following");
  await expect(page).toHaveURL(/\/fr\/accept-legal\?returnTo=/);
  expect((await context.request.get("/api/following")).status()).toBe(401);
});

test("Following displays an authorized current avatar and falls back after removal", async ({
  page,
  context,
  baseURL,
}) => {
  const uploader = await account("Avatar walker");
  await session(context, baseURL!, uploader);
  const { default: sharp } = await import("sharp");
  const png = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#246f68" },
  })
    .png()
    .toBuffer();
  const uploaded = await context.request.post("/api/files?purpose=avatar", {
    headers: { origin: baseURL!, "Content-Type": "image/png" },
    data: png,
  });
  expect(uploaded.status()).toBe(201);
  const follower = await account();
  await pool.query(
    "INSERT INTO uploader_follows(follower_id,uploader_id) VALUES($1,$2)",
    [follower, uploader],
  );
  await session(context, baseURL!, follower);
  await page.goto("/en/following");
  const image = page.getByRole("listitem").locator("img");
  await expect(image).toHaveAttribute(
    "src",
    `/api/following/${uploader}/avatar`,
  );
  await expect
    .poll(() =>
      image.evaluate(
        (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
      ),
    )
    .toBe(true);
  const outsider = await account();
  await session(context, baseURL!, outsider);
  expect(
    (await context.request.get(`/api/following/${uploader}/avatar`)).status(),
  ).toBe(404);
  await session(context, baseURL!, follower);
  await pool.query("UPDATE users SET avatar_file_id=NULL WHERE id=$1", [
    uploader,
  ]);
  await page.reload();
  await expect(image).toHaveCount(0);
});

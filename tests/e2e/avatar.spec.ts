import { expect, selectTheme, test } from "./fixtures";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import sharp from "sharp";
import type { BrowserContext, Page } from "@playwright/test";
import english from "../../messages/en.json";
import spanish from "../../messages/es.json";
import { animatedPng } from "../storage/animated-png";

loadEnvConfig(process.cwd(), true);
test.describe.configure({ mode: "default" });
test.skip(!!process.env.TEST_BASE_URL, "Avatar tests require the isolated local-storage harness");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const owned = new Set<string>();
test.afterAll(() => pool.end());
test.afterEach(async () => {
  for (const id of owned) {
    await pool.query("UPDATE users SET avatar_file_id=NULL WHERE id=$1", [id]);
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [id]);
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
  }
  owned.clear();
});

async function account() {
  const token = randomBytes(32).toString("base64url");
  const { rows: [user] } = await pool.query<{ id: string }>("INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth,email_confirmed) VALUES('Ada','Lovelace',$1,'synthetic','1815-12-10',true) RETURNING id", [`avatar-${randomUUID()}@example.test`]);
  if (!user) throw Error("Avatar fixture account missing");
  owned.add(user.id);
  await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')", [user.id, createHash("sha256").update(token).digest("hex")]);
  return { id: user.id, token };
}
async function authenticate(context: BrowserContext, baseURL: string | undefined) {
  if (!baseURL) throw Error("Browser base URL required");
  const user = await account();
  await context.addCookies([{ name: "track_atlas_session", value: user.token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  return user;
}
async function imageBytes(format: "png" | "jpeg" | "gif" | "avif") {
  return sharp({ create: { width: 1300, height: 700, channels: 3, background: "#446699" } })
    .withMetadata({ orientation: 6 }).toFormat(format).toBuffer();
}
async function savedId(userId: string) {
  const { rows: [user] } = await pool.query<{ avatar_file_id: string | null }>("SELECT avatar_file_id FROM users WHERE id=$1", [userId]);
  if (!user?.avatar_file_id) throw Error("Saved avatar reference missing");
  return user.avatar_file_id;
}
async function assertOriginal(page: Page, userId: string, bytes: Buffer, contentType: string, alt: string) {
  const id = await savedId(userId);
  const image = page.getByRole("img", { name: alt, exact: true });
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.src)).toBe(new URL(`/api/avatars/${id}`, page.url()).href);
  await expect(image).toHaveCSS("object-fit", "contain");
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  expect(await image.getAttribute("srcset")).toBeNull();
  const response = await page.context().request.get(`/api/avatars/${id}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe(contentType);
  expect(response.headers()["content-disposition"]).toMatch(/^inline/);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  const original = await response.body();
  expect(original).toEqual(bytes);
  const metadata = await sharp(original).metadata();
  const sourceMetadata = await sharp(bytes).metadata();
  expect(metadata.width).toBe(sourceMetadata.width);
  expect(metadata.height).toBe(sourceMetadata.height);
  expect(metadata.orientation).toBe(sourceMetadata.orientation);
  expect(metadata.exif).toEqual(sourceMetadata.exif);
  const download = await page.context().request.get(`/api/files/${id}`);
  expect(download.status()).toBe(200);
  expect(await download.body()).toEqual(bytes);
  const { rows: [file] } = await pool.query("SELECT purpose,status,object_key,content_type,byte_size FROM stored_files WHERE id=$1 AND owner_id=$2", [id, userId]);
  expect(file).toMatchObject({ purpose: "avatar", status: "ready", object_key: `avatars/original/${id}`, content_type: contentType });
  expect(Number(file.byte_size)).toBe(bytes.length);
  return id;
}

const cases = [
  { locale: "en", theme: "light", width: 1280 },
  { locale: "es", theme: "dark", width: 375 },
  { locale: "en", theme: "dark", width: 375 },
  { locale: "es", theme: "light", width: 1280 },
] satisfies { locale: "en" | "es"; theme: "light" | "dark"; width: number }[];
for (const { locale, theme, width } of cases) test(`${locale} ${theme} ${width}px optional avatar saves originals, reloads and replaces without losing drafts`, async ({ page, context, baseURL, request }, testInfo) => {
  const user = await authenticate(context, baseURL);
  const labels = (locale === "en" ? english : spanish).Settings;
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`/${locale}/settings`);
  await selectTheme(page, theme);
  const form = page.getByRole("form", { name: labels.avatar.title, exact: true });
  const picker = form.getByLabel(labels.avatar.file, { exact: false });
  const button = form.getByRole("button", { name: labels.avatar.submit, exact: true });
  await expect(button).toBeDisabled();
  await expect(picker).toBeEnabled();
  await expect(picker).not.toHaveAttribute("required");
  await expect(picker).toHaveAttribute("accept", "image/*");
  await expect(button.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  const empty = page.getByText(labels.avatar.empty, { exact: true });
  await expect(empty).toBeVisible();
  expect(await empty.evaluate(element => element.parentElement?.getBoundingClientRect().height)).toBeLessThan(40);
  await expect(form).not.toContainText(/metadata|metadatos|Only you can view|Solo tú puedes ver|original file|archivo original/i);
  expect(await picker.evaluate(element => {
    const style = getComputedStyle(element, "::file-selector-button");
    return { border: style.borderRightWidth, background: style.backgroundColor, margin: style.marginRight };
  })).toMatchObject({ border: "1px", margin: "12px" });
  const backgrounds = await picker.evaluate(element => ({ input: getComputedStyle(element).backgroundColor, button: getComputedStyle(element, "::file-selector-button").backgroundColor }));
  expect(backgrounds.button).not.toBe(backgrounds.input);
  expect(backgrounds.button).not.toBe("rgba(0, 0, 0, 0)");
  await testInfo.attach(`avatar-empty-${locale}-${theme}-${width}`, { body: await form.locator("..").screenshot(), contentType: "image/png" });
  const profile = page.getByRole("form", { name: labels.profile.title, exact: true });
  await profile.locator('[name="displayName"]').fill("Saved without avatar");
  await profile.getByRole("button", { name: labels.profile.submit, exact: true }).click();
  await expect(profile.getByRole("status")).toHaveText(labels.profile.success);
  await expect(button).toBeDisabled();
  await profile.locator('[name="firstName"]').fill("Unsaved profile draft");
  const password = page.getByRole("form", { name: labels.password.title, exact: true }).locator('[name="password"]');
  await password.fill("Unsaved password draft");

  const png = await imageBytes("png");
  await picker.setInputFiles({ name: "original.png", mimeType: "image/png", buffer: png });
  const gate = Promise.withResolvers<void>();
  await page.route("**/api/files?purpose=avatar", async route => { const response = await route.fetch(); await gate.promise; await route.fulfill({ response }); });
  try {
    await button.click();
    await expect(form).toHaveAttribute("aria-busy", "true");
    await expect(form.getByRole("status")).toHaveText(labels.avatar.pending);
    await expect(form.locator('button[type="submit"]')).toBeDisabled();
    await expect(picker).toBeDisabled();
  } finally { gate.resolve(); }
  await expect(form.getByRole("status")).toHaveText(labels.avatar.success);
  await page.unroute("**/api/files?purpose=avatar");
  const firstId = await assertOriginal(page, user.id, png, "image/png", labels.avatar.imageAlt);
  await expect(profile.locator('[name="firstName"]')).toHaveValue("Unsaved profile draft");
  await expect(password).toHaveValue("Unsaved password draft");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await assertOriginal(page, user.id, png, "image/png", labels.avatar.imageAlt);

  const jpeg = await imageBytes("jpeg");
  await expect(picker).toBeEnabled();
  await picker.setInputFiles({ name: "replacement.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await button.click();
  await expect(form.getByRole("status")).toHaveText(labels.avatar.success);
  const secondId = await assertOriginal(page, user.id, jpeg, "image/jpeg", labels.avatar.imageAlt);
  expect(secondId).not.toBe(firstId);
  await page.reload();
  await assertOriginal(page, user.id, jpeg, "image/jpeg", labels.avatar.imageAlt);

  let currentId = secondId;
  let currentBytes = jpeg;
  let currentType = "image/jpeg";
  for (const format of ["gif", "avif"] as const) {
    currentBytes = await imageBytes(format);
    currentType = `image/${format}`;
    await expect(picker).toBeEnabled();
    await picker.setInputFiles({ name: `original.${format}`, mimeType: format === "gif" ? "" : currentType, buffer: currentBytes });
    await button.click();
    await expect(form.getByRole("status")).toHaveText(labels.avatar.success);
    currentId = await assertOriginal(page, user.id, currentBytes, currentType, labels.avatar.imageAlt);
  }
  await testInfo.attach(`avatar-saved-${locale}-${theme}-${width}`, { body: await form.locator("..").screenshot(), contentType: "image/png" });

  for (const file of [
    { name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") },
    { name: "animated.png", mimeType: "image/png", buffer: animatedPng() },
    { name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) },
    { name: "not-image.png", mimeType: "image/png", buffer: Buffer.from("not an image") },
  ]) {
    await expect(picker).toBeEnabled();
    await picker.setInputFiles(file);
    await button.click();
    await expect(form.getByRole("alert")).toHaveText(file.name === "large.png" ? labels.avatar.errors.tooLarge : labels.avatar.errors.invalidFile);
    await expect(form.getByRole("alert")).toBeFocused();
    await expect(picker).toHaveAttribute("aria-invalid", "true");
    expect(await savedId(user.id)).toBe(currentId);
    await assertOriginal(page, user.id, currentBytes, currentType, labels.avatar.imageAlt);
  }
  const foreign = await account();
  expect((await request.get(`/api/avatars/${currentId}`)).status()).toBe(401);
  expect((await request.get(`/api/avatars/${currentId}`, { headers: { cookie: `track_atlas_session=${foreign.token}` } })).status()).toBe(404);
  expect((await context.request.get(`/api/avatars/${randomUUID()}`)).status()).toBe(404);
  expect((await request.post("/api/files?purpose=avatar", { data: png, headers: { "content-type": "image/png" } })).status()).toBe(401);
  expect((await context.request.post("/api/files?purpose=avatar", { data: Buffer.alloc(5 * 1024 * 1024 + 1), headers: { origin: new URL(baseURL ?? "").origin, "content-type": "image/png" } })).status()).toBe(413);
  expect(await savedId(user.id)).toBe(currentId);
  await profile.locator('[name="firstName"]').fill("Keep after removal");
  await password.fill("Keep password after removal");
  const remove = form.getByRole("button", { name: labels.avatar.remove, exact: true });
  await expect(remove.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  const deleteGate = Promise.withResolvers<void>();
  await page.route(`**/api/files/${currentId}`, async route => { await deleteGate.promise; await route.continue(); });
  try {
    await remove.click();
    await expect(form).toHaveAttribute("aria-busy", "true");
    await expect(form.getByRole("status")).toHaveText(labels.avatar.removing);
    await expect(picker).toBeDisabled();
    await expect(form.locator("button:disabled")).toHaveCount(2);
  } finally { deleteGate.resolve(); }
  await expect(form.getByRole("status")).toHaveText(labels.avatar.removed);
  await expect(page.getByRole("img", { name: labels.avatar.imageAlt })).toHaveCount(0);
  await expect(empty).toBeVisible();
  expect(await empty.evaluate(element => element.parentElement?.getBoundingClientRect().height)).toBeLessThan(40);
  await expect(picker).toBeFocused();
  await expect(picker).toHaveValue("");
  await expect(remove).toHaveCount(0);
  expect((await pool.query("SELECT avatar_file_id FROM users WHERE id=$1", [user.id])).rows[0].avatar_file_id).toBeNull();
  expect((await context.request.get(`/api/files/${currentId}`)).status()).toBe(404);
  await expect(profile.locator('[name="firstName"]')).toHaveValue("Keep after removal");
  await expect(password).toHaveValue("Keep password after removal");
  await testInfo.attach(`avatar-removed-${locale}-${theme}-${width}`, { body: await form.locator("..").screenshot(), contentType: "image/png" });
});

for (const locale of ["en", "es"] as const) test(`${locale} avatar handles safe errors, connection failure and broken saved image`, async ({ page, context, baseURL }) => {
  const user = await authenticate(context, baseURL);
  const labels = (locale === "en" ? english : spanish).Settings.avatar;
  await page.goto(`/${locale}/settings`);
  const form = page.getByRole("form", { name: labels.title, exact: true });
  const picker = form.locator('input[type="file"]');
  await expect(picker).toBeEnabled();
  const bytes = await imageBytes("png");
  await picker.setInputFiles({ name: "image.png", mimeType: "image/png", buffer: bytes });
  const submit = form.getByRole("button", { name: labels.submit, exact: true });
  await submit.click();
  await expect(form.getByRole("status")).toHaveText(labels.success);
  const id = await assertOriginal(page, user.id, bytes, "image/png", labels.imageAlt);
  for (const code of ["quotaExceeded", "unauthorized", "unavailable", "injected server error"] as const) {
    await page.route("**/api/files?purpose=avatar", route => route.fulfill({ status: 503, json: { error: code } }));
    await expect(picker).toBeEnabled();
    await picker.setInputFiles({ name: "retry.png", mimeType: "image/png", buffer: bytes });
    await submit.click();
    await expect(form.getByRole("alert")).toHaveText(code === "injected server error" ? labels.errors.unavailable : labels.errors[code]);
    await expect(form.getByRole("alert")).toBeFocused();
    expect(await savedId(user.id)).toBe(id);
    await page.unroute("**/api/files?purpose=avatar");
  }
  await page.route("**/api/files?purpose=avatar", route => route.abort("failed"));
  await submit.click();
  await expect(form.getByRole("alert")).toHaveText(labels.errors.unavailable);
  await page.unroute("**/api/files?purpose=avatar");
  await page.route("**/api/files?purpose=avatar", route => route.fulfill({ status: 201, json: { id: "../../foreign", downloadUrl: "https://foreign.example/image" } }));
  await submit.click();
  await expect(form.getByRole("alert")).toHaveText(labels.errors.unavailable);
  expect(await page.getByRole("img", { name: labels.imageAlt }).evaluate((image: HTMLImageElement) => image.src)).toBe(new URL(`/api/avatars/${id}`, page.url()).href);
  await page.route(`**/api/avatars/${id}`, route => route.fulfill({ status: 404 }));
  await page.reload();
  await expect(page.getByText(labels.imageUnavailable, { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: labels.imageAlt })).toHaveCount(0);
  await expect(form.getByRole("button", { name: labels.remove, exact: true })).toBeEnabled();
});

for (const replacement of ["form", "external"] as const) test(`removal targets the ${replacement} replacement after an earlier deletion failure`, async ({ page, context, baseURL }) => {
  const user = await authenticate(context, baseURL);
  const labels = english.Settings.avatar;
  await page.goto("/en/settings");
  const form = page.getByRole("form", { name: labels.title, exact: true });
  const picker = form.locator('input[type="file"]');
  const submit = form.getByRole("button", { name: labels.submit, exact: true });
  const remove = form.getByRole("button", { name: labels.remove, exact: true });
  const bytes = await imageBytes("png");
  await expect(picker).toBeEnabled();
  await picker.setInputFiles({ name: "first.png", mimeType: "image/png", buffer: bytes });
  await submit.click();
  await expect(form.getByRole("status")).toHaveText(labels.success);
  const firstId = await assertOriginal(page, user.id, bytes, "image/png", labels.imageAlt);
  await page.route(`**/api/files/${firstId}`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(204);
    await route.fulfill({ status: 503, json: { error: "unavailable" } });
  });
  await remove.click();
  await expect(form.getByRole("alert")).toHaveText(labels.removeError);
  await expect(page.getByText(labels.empty, { exact: true })).toBeVisible();
  await page.unroute(`**/api/files/${firstId}`);
  await expect(picker).toBeEnabled();
  if (replacement === "form") {
    await picker.setInputFiles({ name: "current.png", mimeType: "image/png", buffer: bytes });
    await submit.click();
    await expect(form.getByRole("status")).toHaveText(labels.success);
  } else {
    const response = await context.request.post("/api/files?purpose=avatar", { data: bytes, headers: { origin: new URL(baseURL ?? "").origin, "content-type": "image/png" } });
    expect(response.status()).toBe(201);
    const profile = page.getByRole("form", { name: english.Settings.profile.title, exact: true });
    await profile.getByRole("button", { name: english.Settings.profile.submit, exact: true }).click();
    await expect(profile.getByRole("status")).toHaveText(english.Settings.profile.success);
  }
  const currentId = await assertOriginal(page, user.id, bytes, "image/png", labels.imageAlt);
  expect(currentId).not.toBe(firstId);
  const deletion = page.waitForRequest(request => request.method() === "DELETE");
  await remove.click();
  expect((await deletion).url()).toBe(new URL(`/api/files/${currentId}`, page.url()).href);
  await expect(form.getByRole("status")).toHaveText(labels.removed);
  await expect(page.getByRole("img", { name: labels.imageAlt })).toHaveCount(0);
  expect((await pool.query("SELECT avatar_file_id FROM users WHERE id=$1", [user.id])).rows[0].avatar_file_id).toBeNull();
});

for (const locale of ["en", "es"] as const) test(`${locale} failed removal keeps the detached file retryable and never clears a newer avatar`, async ({ page, context, baseURL }) => {
  const user = await authenticate(context, baseURL);
  const labels = (locale === "en" ? english : spanish).Settings.avatar;
  await page.goto(`/${locale}/settings`);
  const form = page.getByRole("form", { name: labels.title, exact: true });
  const picker = form.locator('input[type="file"]');
  const submit = form.getByRole("button", { name: labels.submit, exact: true });
  const remove = form.getByRole("button", { name: labels.remove, exact: true });
  const bytes = await imageBytes("png");
  await expect(picker).toBeEnabled();
  await picker.setInputFiles({ name: "image.png", mimeType: "image/png", buffer: bytes });
  await submit.click();
  await expect(form.getByRole("status")).toHaveText(labels.success);
  const firstId = await assertOriginal(page, user.id, bytes, "image/png", labels.imageAlt);
  await page.route(`**/api/files/${firstId}`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(204);
    await route.fulfill({ status: 503, json: { error: "unavailable" } });
  });
  await remove.click();
  await expect(form.getByRole("alert")).toHaveText(labels.removeError);
  await expect(form.getByRole("alert")).toBeFocused();
  await expect(form.getByRole("status")).not.toHaveText(labels.removed);
  await expect(page.getByText(labels.empty, { exact: true })).toBeVisible();
  expect((await pool.query("SELECT avatar_file_id FROM users WHERE id=$1", [user.id])).rows[0].avatar_file_id).toBeNull();
  await expect(remove).toBeEnabled();
  await page.unroute(`**/api/files/${firstId}`);
  const retried = page.waitForRequest(request => request.method() === "DELETE" && request.url().endsWith(`/api/files/${firstId}`));
  await remove.click();
  await retried;
  await expect(form.getByRole("status")).toHaveText(labels.removed);
  await expect(remove).toHaveCount(0);
  await expect(picker).toBeFocused();
  expect((await context.request.delete(`/api/files/${firstId}`, { headers: { origin: new URL(baseURL ?? "").origin } })).status()).toBe(204);

  await expect(picker).toBeEnabled();
  await picker.setInputFiles({ name: "second.png", mimeType: "image/png", buffer: bytes });
  await submit.click();
  await expect(form.getByRole("status")).toHaveText(labels.success);
  const secondId = await assertOriginal(page, user.id, bytes, "image/png", labels.imageAlt);
  const deleted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(`**/api/files/${secondId}`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(204);
    deleted.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await remove.click();
    await deleted.promise;
    await expect(picker).toBeDisabled();
    await expect(form.locator("button:disabled")).toHaveCount(2);
    const replacement = await context.request.post("/api/files?purpose=avatar", { data: bytes, headers: { origin: new URL(baseURL ?? "").origin, "content-type": "application/octet-stream" } });
    expect(replacement.status()).toBe(201);
    expect(await savedId(user.id)).not.toBe(secondId);
  } finally { release.resolve(); }
  await expect(form.getByRole("status")).toHaveText(labels.removed);
  await assertOriginal(page, user.id, bytes, "image/png", labels.imageAlt);
  await expect(remove).toBeEnabled();
});

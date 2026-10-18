import { expect, test } from "./fixtures";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import sharp from "sharp";

loadEnvConfig(process.cwd(), true);
test.describe.configure({ mode: "default" });
test.skip(!!process.env.TEST_BASE_URL, "File endpoint tests require the isolated local-storage harness");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const owned = new Set<string>();
const gpx = Buffer.from('<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="browser-tests"><trk><name>Private route</name></trk></gpx>');
test.afterAll(() => pool.end());
test.afterEach(async () => {
  for (const id of owned) {
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [id]);
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
  }
  owned.clear();
});

async function account() {
  const token = randomBytes(32).toString("base64url");
  const { rows: [user] } = await pool.query("INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES('Ada','Lovelace',$1,'synthetic','1815-12-10') RETURNING id", [`files-${randomUUID()}@example.test`]);
  owned.add(user.id);
  await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')", [user.id, createHash("sha256").update(token).digest("hex")]);
  return token;
}

for (const purpose of ["avatar", "gpx"] as const) test(`${purpose} uploads through real endpoints and stays private to the browser session`, async ({ page, context, request, baseURL }) => {
  const token = await account();
  await context.addCookies([{ name: "track_atlas_session", value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/en");
  const bytes = purpose === "gpx" ? gpx : await sharp({ create: { width: 48, height: 48, channels: 3, background: "red" } }).png().toBuffer();
  const created = await page.evaluate(async ({ purpose, bytes }) => {
    const response = await fetch(`/api/files?purpose=${purpose}`, { method: "POST", headers: { "content-type": purpose === "gpx" ? "application/gpx+xml" : "image/png" }, body: new Uint8Array(bytes) });
    return { status: response.status, file: await response.json() };
  }, { purpose, bytes: [...bytes] });
  expect(created.status).toBe(201);
  expect(created.file.purpose).toBe(purpose);
  expect(created.file.storageLocation).toBeUndefined();
  const guest = await request.get(created.file.downloadUrl);
  expect(guest.status()).toBe(401);
  const foreign = await account();
  const foreignDownload = await request.get(created.file.downloadUrl, { headers: { cookie: `track_atlas_session=${foreign}` } });
  expect(foreignDownload.status()).toBe(404);
  const downloaded = await context.request.get(created.file.downloadUrl);
  expect(downloaded.status()).toBe(200);
  expect(downloaded.headers()["cache-control"]).toBe("private, no-store");
  expect(downloaded.headers()["content-type"]).toBe("application/octet-stream");
  expect(downloaded.headers()["x-content-type-options"]).toBe("nosniff");
  expect(await downloaded.body()).toEqual(bytes);
  const csrf = await context.request.delete(created.file.downloadUrl, { headers: { origin: "https://foreign.example" } });
  expect(csrf.status()).toBe(403);
  const removed = await page.evaluate(async url => (await fetch(url, { method: "DELETE" })).status, created.file.downloadUrl);
  expect(removed).toBe(204);
  expect((await context.request.get(created.file.downloadUrl)).status()).toBe(404);
});

test("real upload endpoint rejects guests, malformed files, duplicate purposes and oversized bodies", async ({ request, baseURL }) => {
  expect((await request.post("/api/files?purpose=gpx", { data: gpx })).status()).toBe(401);
  const token = await account();
  const headers = { cookie: `track_atlas_session=${token}`, origin: new URL(baseURL!).origin, "content-type": "application/gpx+xml" };
  expect((await request.post("/api/files?purpose=gpx&purpose=avatar", { headers, data: gpx })).status()).toBe(400);
  expect((await request.post("/api/files?purpose=gpx", { headers, data: "<!DOCTYPE gpx><gpx/>" })).status()).toBe(422);
  expect((await request.post("/api/files?purpose=gpx", { headers, data: Buffer.alloc(10 * 1024 * 1024 + 1) })).status()).toBe(413);
});

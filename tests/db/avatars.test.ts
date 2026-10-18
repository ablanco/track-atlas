import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { createDatabase } from "../../db/client";
import { storedFiles, users } from "../../db/schema";
import { createSession, revokeSession } from "../../auth/session-store";
import { getSettingsProfile } from "../../auth/settings";
import type { Database } from "../../auth/database";
import { getStorageConfig } from "../../storage/config";
import { createObjectStore, type ObjectStore } from "../../storage/objects";
import { cleanupFiles, deleteFile, downloadFile, uploadFile } from "../../storage/files";
import { handleFileRequest } from "../../storage/http";
import { FileError } from "../../storage/validation";
import { signupFixture } from "./auth-helpers";

loadEnvConfig(process.cwd(), true);
const { db, pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
const image = sharp({ create: { width: 1500, height: 750, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
async function fixture(work: (context: { token: string; userId: string; directory: string; store: ObjectStore }) => Promise<void>) {
  const [user] = await db.insert(users).values({ ...signupFixture(), passwordHash: "synthetic" }).returning();
  const directory = await mkdtemp(join(tmpdir(), "atlas-avatar-db-"));
  const store = createObjectStore(getStorageConfig({ NODE_ENV: "development", FILE_STORAGE_LOCAL_DIR: directory }));
  try { await work({ userId: user.id, token: (await createSession(db, user.id)).token, directory, store }); }
  finally {
    await db.delete(storedFiles).where(eq(storedFiles.ownerId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
    await rm(directory, { recursive: true, force: true });
  }
}
const upload = async (token: string, store: ObjectStore, overrides: Partial<Parameters<typeof uploadFile>[0]> = {}) => uploadFile({ db, token, store, purpose: "avatar", contentType: "image/jpeg", read: async () => image, ...overrides });
const code = (value: string) => (error: unknown) => error instanceof FileError && error.code === value;

test("avatar is optional; upload binds exact original bytes and serves private inline JPEG", async () => fixture(async ({ token, userId, directory, store }) => {
  assert.equal((await getSettingsProfile(db, token))?.avatarFileId, null);
  const file = await upload(token, store);
  const [row] = await db.select().from(storedFiles).where(eq(storedFiles.id, file.id));
  assert.equal(row.objectKey, `avatars/original/${file.id}`);
  assert.equal(row.ownerId, userId);
  assert.equal(row.contentType, "image/jpeg");
  assert.equal(row.sha256, createHash("sha256").update(await image).digest("hex"));
  assert.equal(row.byteSize, (await image).length);
  assert.equal((await getSettingsProfile(db, token))?.avatarFileId, file.id);
  assert.deepEqual(await readFile(join(directory, row.objectKey)), await image);
  const response = await handleFileRequest(new Request(`https://atlas.example/api/avatars/${file.id}`), { db, token, store, origin: "https://atlas.example" }, file.id, "avatar");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.match(response.headers.get("content-disposition") ?? "", /^inline;/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await image);
  const metadata = await sharp(await readFile(join(directory, row.objectKey))).metadata();
  assert.equal(metadata.orientation, 6);
  assert.equal(metadata.width, 1500);
  assert.ok(metadata.exif);
}));

test("failed replacement leaves previous avatar selected and readable", async () => fixture(async ({ token, store }) => {
  const old = await upload(token, store);
  await assert.rejects(upload(token, store, { read: async () => Buffer.from("not an image") }), code("invalidFile"));
  assert.equal((await getSettingsProfile(db, token))?.avatarFileId, old.id);
  assert.deepEqual((await downloadFile({ db, token, store, id: old.id })).bytes, await image);
  const failing: ObjectStore = { ...store, put: async () => { throw new Error("private provider key"); } };
  await assert.rejects(upload(token, failing));
  assert.equal((await getSettingsProfile(db, token))?.avatarFileId, old.id);
}));

test("replacement atomically switches avatar and cleanup uses original object keys", async () => fixture(async ({ token, store, userId }) => {
  const old = await upload(token, store);
  const current = await upload(token, store);
  assert.equal((await getSettingsProfile(db, token))?.avatarFileId, current.id);
  const rows = await db.select().from(storedFiles).where(eq(storedFiles.ownerId, userId));
  assert.equal(rows.find(row => row.id === old.id)?.status, "deleting");
  await deleteFile({ db, token, store, id: old.id });
  assert.equal((await getSettingsProfile(db, token))?.avatarFileId, current.id);
  await cleanupFiles({ db, store });
  assert.equal(await store.get(`avatars/original/${old.id}`, (await image).length), null);
  assert.deepEqual((await downloadFile({ db, token, store, id: current.id })).bytes, await image);
  await deleteFile({ db, token, store, id: current.id });
  assert.equal((await getSettingsProfile(db, token))?.avatarFileId, null);
}));

test("concurrent avatar replacements leave one ready file and a consistent account reference", async () => fixture(async ({ token, store, userId }) => {
  await upload(token, store);
  const results = await Promise.all([upload(token, store), upload(token, store)]);
  const selected = (await getSettingsProfile(db, token))?.avatarFileId;
  assert.ok(results.some(result => result.id === selected));
  const rows = await db.select().from(storedFiles).where(eq(storedFiles.ownerId, userId));
  assert.deepEqual(rows.filter(row => row.status === "ready").map(row => row.id), [selected]);
}));

test("revocation while saving cannot replace the old avatar", async () => fixture(async ({ token, store, userId }) => {
  const old = await upload(token, store);
  const interrupted: ObjectStore = { ...store, put: async (...args) => { await store.put(...args); await revokeSession(db, token); } };
  await assert.rejects(upload(token, interrupted), code("unauthorized"));
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  assert.equal(user.avatarFileId, old.id);
  assert.deepEqual(await store.get(`avatars/original/${old.id}`, (await image).length), await image);
}));

test("an uncertain finalization commit preserves the committed avatar and bytes", async () => fixture(async ({ token, store }) => {
  let calls = 0;
  const uncertain = new Proxy(db, { get(target, key, receiver) {
    if (key !== "transaction") return Reflect.get(target, key, receiver);
    return (async (...args: Parameters<Database["transaction"]>) => {
      const result = await target.transaction(...args);
      if (++calls === 2) throw new Error("lost acknowledgement");
      return result;
    }) as Database["transaction"];
  } });
  await assert.rejects(upload(token, store, { db: uncertain }));
  const selected = (await getSettingsProfile(db, token))?.avatarFileId;
  assert.ok(selected);
  assert.deepEqual((await downloadFile({ db, token, store, id: selected })).bytes, await image);
}));

for (const { format, mime } of [{ format: "gif", mime: "image/gif" }, { format: "avif", mime: "image/avif" }, { format: "tiff", mime: "image/tiff" }] as const) {
  test(`original ${format} uploads persist their canonical type and serve unchanged`, async () => fixture(async ({ token, store, directory }) => {
    const bytes = await sharp({ create: { width: 48, height: 24, channels: 3, background: "blue" } }).toFormat(format).toBuffer();
    const file = await upload(token, store, { contentType: "application/octet-stream", read: async () => bytes });
    const [row] = await db.select().from(storedFiles).where(eq(storedFiles.id, file.id));
    assert.equal(row.contentType, mime);
    assert.deepEqual(await readFile(join(directory, row.objectKey)), bytes);
    const response = await handleFileRequest(new Request(`https://atlas.example/api/avatars/${file.id}`), { db, token, store, origin: "https://atlas.example" }, file.id, "avatar");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), mime);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }));
}

test("HTTP removal deletes original bytes, and failed physical deletion remains retryable", async () => fixture(async ({ token, store, directory }) => {
  const file = await upload(token, store);
  const path = join(directory, `avatars/original/${file.id}`);
  const request = () => new Request(`https://atlas.example/api/files/${file.id}`, { method: "DELETE", headers: { origin: "https://atlas.example" } });
  const failing: ObjectStore = { ...store, remove: async () => { throw new Error("private storage failure"); } };
  const failure = await handleFileRequest(request(), { db, token, store: failing, origin: "https://atlas.example" }, file.id);
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), { error: "unavailable" });
  assert.equal((await getSettingsProfile(db, token))?.avatarFileId, null);
  assert.deepEqual(await readFile(path), await image);
  const success = await handleFileRequest(request(), { db, token, store, origin: "https://atlas.example" }, file.id);
  assert.equal(success.status, 204);
  await assert.rejects(readFile(path), { code: "ENOENT" });
  assert.equal((await handleFileRequest(request(), { db, token, store, origin: "https://atlas.example" }, file.id)).status, 204);
}));

test("removing an old avatar concurrently with replacement never detaches or deletes the new original", async () => fixture(async ({ token, store }) => {
  const old = await upload(token, store);
  const [, current] = await Promise.all([deleteFile({ db, token, store, id: old.id }), upload(token, store)]);
  assert.equal((await getSettingsProfile(db, token))?.avatarFileId, current.id);
  assert.equal(await store.get(`avatars/original/${old.id}`, (await image).length), null);
  assert.deepEqual((await downloadFile({ db, token, store, id: current.id })).bytes, await image);
}));

test("legacy flat avatar keys remain readable without probing or moving objects", async () => fixture(async ({ token, store }) => {
  const file = await upload(token, store);
  await store.put(file.id, await image, "image/jpeg");
  await db.update(storedFiles).set({ objectKey: file.id }).where(eq(storedFiles.id, file.id));
  await store.remove(`avatars/original/${file.id}`);
  assert.deepEqual((await downloadFile({ db, token, store, id: file.id })).bytes, await image);
}));

test("avatar migration backfills flat object keys before enforcing non-null", async () => {
  const client = await pool.connect();
  const schema = `avatar_migration_${randomUUID().replaceAll("-", "")}`;
  const id = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema},public`);
    await client.query(`CREATE TABLE stored_files(id uuid PRIMARY KEY, purpose text, status text, content_type text, sha256 text, CONSTRAINT stored_files_ready_check CHECK (true)); CREATE TABLE users(id uuid PRIMARY KEY)`);
    await client.query("INSERT INTO stored_files(id,purpose,status,content_type,sha256) VALUES($1,'avatar','ready','image/webp',$2)", [id, "a".repeat(64)]);
    const migration = await readFile(new URL("../../drizzle/0007_add-original-avatars.sql", import.meta.url), "utf8");
    await client.query(migration.replaceAll('"public"."stored_files"', `"${schema}"."stored_files"`));
    const { rows: [file] } = await client.query("SELECT object_key,content_type FROM stored_files WHERE id=$1", [id]);
    assert.deepEqual(file, { object_key: id, content_type: "image/webp" });
    const { rows: [column] } = await client.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='stored_files' AND column_name='object_key'", [schema]);
    assert.equal(column.is_nullable, "NO");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("inline avatar serving rejects GPX, guests and foreign owners", async () => fixture(async ({ token, store }) => {
  const gpx = Buffer.from('<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests"/>');
  const track = await uploadFile({ db, token, store, purpose: "gpx", contentType: "application/gpx+xml", read: async () => gpx });
  const avatar = await upload(token, store);
  const get = (id: string, session: string | undefined) => handleFileRequest(new Request(`https://atlas.example/api/avatars/${id}`), { db, token: session, store, origin: "https://atlas.example" }, id, "avatar");
  assert.equal((await get(track.id, token)).status, 404);
  assert.equal((await get(avatar.id, undefined)).status, 401);
  await fixture(async other => { assert.equal((await get(avatar.id, other.token)).status, 404); });
}));

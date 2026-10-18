import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import { storedFiles, users } from "../../db/schema";
import { createSession, revokeSession } from "../../auth/session-store";
import type { Database } from "../../auth/database";
import { signupFixture } from "./auth-helpers";
import { getStorageConfig } from "../../storage/config";
import { createObjectStore, type ObjectStore } from "../../storage/objects";
import { cleanupFiles, deleteFile, downloadFile, uploadFile } from "../../storage/files";
import { FileError, uploadPolicies } from "../../storage/validation";
import { handleFileRequest } from "../../storage/http";

loadEnvConfig(process.cwd(), true);
const { db, pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
const gpx = Buffer.from('<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests"><trk/></gpx>');
const code = (value: string) => (error: unknown) => error instanceof FileError && error.code === value;
async function fixture(work: (context: { userId: string; token: string; store: ObjectStore }) => Promise<void>) {
  const [user] = await db.insert(users).values({ ...signupFixture(), passwordHash: "synthetic" }).returning();
  const directory = await mkdtemp(join(tmpdir(), "atlas-file-db-"));
  const store = createObjectStore(getStorageConfig({ NODE_ENV: "development", FILE_STORAGE_LOCAL_DIR: directory }));
  try { await work({ userId: user.id, token: (await createSession(db, user.id)).token, store }); }
  finally {
    await db.delete(storedFiles).where(eq(storedFiles.ownerId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
    await rm(directory, { recursive: true, force: true });
  }
}
const upload = (token: string | undefined, store: ObjectStore, overrides: Partial<Parameters<typeof uploadFile>[0]> = {}) => uploadFile({ db, token, store, purpose: "gpx", contentType: "application/gpx+xml", read: async () => gpx, ...overrides });

test("upload, owned download and retry-safe delete use private metadata and real disk", async () => fixture(async ({ userId, token, store }) => {
  const file = await upload(token, store);
  assert.deepEqual(Object.keys(file).sort(), ["byteSize", "contentType", "createdAt", "downloadUrl", "id", "purpose"]);
  assert.equal(file.byteSize, gpx.length);
  assert.deepEqual((await downloadFile({ db, store, token, id: file.id })).bytes, gpx);
  const [row] = await db.select().from(storedFiles).where(eq(storedFiles.id, file.id));
  assert.equal(row.ownerId, userId); assert.equal(row.status, "ready");
  assert.equal(row.storageLocation, store.location); assert.equal(row.sha256?.length, 64);
  assert.ok(row.updatedAt > row.createdAt);
  await assert.rejects(db.delete(users).where(eq(users.id, userId)));
  await deleteFile({ db, store, token, id: file.id });
  await deleteFile({ db, store, token, id: file.id });
  await assert.rejects(downloadFile({ db, store, token, id: file.id }), code("notFound"));
  assert.equal(await store.get(file.id, gpx.length), null);
  assert.equal((await db.select().from(storedFiles).where(eq(storedFiles.id, file.id)))[0].status, "deleting");
}));

for (const kind of ["missing", "malformed", "unknown", "revoked", "inactive"] as const) test(`uploads reject ${kind} authentication before reading or writing bytes`, async () => fixture(async ({ userId, token, store }) => {
  if (kind === "revoked") await revokeSession(db, token);
  if (kind === "inactive") await db.update(users).set({ active: false }).where(eq(users.id, userId));
  const candidate = kind === "missing" ? undefined : kind === "malformed" ? "bad" : kind === "unknown" ? "A".repeat(43) : token;
  let read = false;
  await assert.rejects(upload(candidate, store, { read: async () => { read = true; return gpx; } }), code("unauthorized"));
  assert.equal(read, false);
  assert.equal((await db.select().from(storedFiles).where(eq(storedFiles.ownerId, userId))).length, 0);
}));

test("foreign and nonexistent file IDs are indistinguishable and cannot be deleted", async () => fixture(async ({ token, store }) => {
  const file = await upload(token, store);
  await fixture(async (other) => {
    for (const id of [file.id, randomUUID(), "../../etc/passwd"]) {
      await assert.rejects(downloadFile({ db, store, token: other.token, id }), code("notFound"));
      await assert.rejects(deleteFile({ db, store, token: other.token, id }), code("notFound"));
    }
  });
  assert.deepEqual((await downloadFile({ db, store, token, id: file.id })).bytes, gpx);
}));

test("revoked session during object write cannot finalize and leaves retryable cleanup", async () => fixture(async ({ token, store, userId }) => {
  const interrupted: ObjectStore = { ...store, location: store.location,
    put: async (...args) => { await store.put(...args); await revokeSession(db, token); },
    get: (...args) => store.get(...args), remove: async () => { throw new Error("private storage details"); },
  };
  await assert.rejects(upload(token, interrupted), code("unauthorized"));
  const [file] = await db.select().from(storedFiles).where(eq(storedFiles.ownerId, userId));
  assert.equal(file.status, "deleting");
  assert.deepEqual(await store.get(file.id, gpx.length), gpx);
  await cleanupFiles({ db, store });
  assert.equal(await store.get(file.id, gpx.length), null);
  assert.equal((await db.select().from(storedFiles).where(eq(storedFiles.id, file.id))).length, 1);
  await db.update(storedFiles).set({ deleteAfter: sql`clock_timestamp() - interval '1 second'` }).where(eq(storedFiles.id, file.id));
  await cleanupFiles({ db, store });
  assert.equal((await db.select().from(storedFiles).where(eq(storedFiles.id, file.id))).length, 0);
}));

test("lost finalization response never deletes an already committed ready object", async () => fixture(async ({ token, store, userId }) => {
  let calls = 0;
  const uncertain = new Proxy(db, { get(target, key, receiver) {
    if (key !== "transaction") return Reflect.get(target, key, receiver);
    return (async (...args: Parameters<Database["transaction"]>) => {
      const result = await target.transaction(...args);
      if (++calls === 2) throw new Error("lost commit acknowledgement");
      return result;
    }) as Database["transaction"];
  } });
  await assert.rejects(upload(token, store, { db: uncertain }));
  const [file] = await db.select().from(storedFiles).where(eq(storedFiles.ownerId, userId));
  assert.equal(file.status, "ready");
  assert.deepEqual((await downloadFile({ db, store, token, id: file.id })).bytes, gpx);
}));

test("invalid bytes never reach storage and failed writes remain cleanup candidates", async () => fixture(async ({ token, store, userId }) => {
  let writes = 0;
  const failing: ObjectStore = { location: store.location, get: (...args) => store.get(...args), remove: (...args) => store.remove(...args),
    put: async () => { writes++; throw new Error("private provider error"); },
  };
  await assert.rejects(upload(token, failing, { read: async () => Buffer.from("not XML") }), code("invalidFile"));
  assert.equal(writes, 0);
  await assert.rejects(upload(token, failing));
  assert.equal(writes, 1);
  const rows = await db.select().from(storedFiles).where(eq(storedFiles.ownerId, userId));
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.status === "deleting"));
}));

test("pending reservations serialize count/byte quotas and cleanup expires abandoned uploads", async () => fixture(async ({ token, userId, store }) => {
  for (let i = 0; i < 2; i++) await db.insert(storedFiles).values({ id: randomUUID(), ownerId: userId, purpose: "gpx", storageLocation: store.location, byteSize: uploadPolicies.gpx.maxBytes });
  let read = false;
  await assert.rejects(upload(token, store, { read: async () => { read = true; return gpx; } }), code("quotaExceeded"));
  assert.equal(read, false);
  await db.update(storedFiles).set({ expiresAt: sql`clock_timestamp() - interval '1 second'` }).where(eq(storedFiles.ownerId, userId));
  assert.equal((await cleanupFiles({ db, store })).processed, 2);
  assert.equal((await db.select().from(storedFiles).where(and(eq(storedFiles.ownerId, userId), eq(storedFiles.status, "pending")))).length, 0);
  assert.ok((await upload(token, store)).id);
}));

test("concurrent uploads reserve only two pending slots across sessions", async () => fixture(async ({ userId, token, store }) => {
  const secondToken = (await createSession(db, userId)).token;
  const firstStarted = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const first = upload(token, store, { read: async () => { firstStarted.resolve(); await release.promise; return gpx; } });
  await firstStarted.promise;
  const second = upload(secondToken, store, { read: async () => { secondStarted.resolve(); await release.promise; return gpx; } });
  await secondStarted.promise;
  try {
    await assert.rejects(upload(token, store), code("quotaExceeded"));
  } finally { release.resolve(); }
  assert.equal((await Promise.all([first, second])).length, 2);
}));

for (const limit of ["count", "bytes"] as const) test(`upload reservations enforce the account ${limit} cap before reading`, async () => fixture(async ({ userId, token, store }) => {
  const rows = Array.from({ length: limit === "count" ? 100 : 25 }, () => ({
    id: randomUUID(), ownerId: userId, purpose: "gpx" as const, status: "ready" as const,
    byteSize: limit === "count" ? 1 : uploadPolicies.gpx.maxBytes, storageLocation: store.location,
    contentType: "application/gpx+xml", sha256: "a".repeat(64),
  }));
  await db.insert(storedFiles).values(rows);
  let read = false;
  await assert.rejects(upload(token, store, { read: async () => { read = true; return gpx; } }), code("quotaExceeded"));
  assert.equal(read, false);
}));

test("database constraints reject incomplete ready records and direct SQL advances audit time", async () => fixture(async ({ token, store }) => {
  const file = await upload(token, store);
  await assert.rejects(db.update(storedFiles).set({ contentType: null }).where(eq(storedFiles.id, file.id)));
  await assert.rejects(db.update(storedFiles).set({ sha256: "bad" }).where(eq(storedFiles.id, file.id)));
  await assert.rejects(db.update(storedFiles).set({ status: "deleting" }).where(eq(storedFiles.id, file.id)));
  const [before] = await db.select().from(storedFiles).where(eq(storedFiles.id, file.id));
  await db.execute(sql`UPDATE stored_files SET byte_size = byte_size WHERE id = ${file.id}`);
  const [after] = await db.select().from(storedFiles).where(eq(storedFiles.id, file.id));
  assert.ok(after.updatedAt > before.updatedAt);
}));

test("location changes and corrupt stored bytes fail closed", async () => fixture(async ({ token, store }) => {
  const file = await upload(token, store);
  const wrong = createObjectStore(getStorageConfig({ NODE_ENV: "development", FILE_STORAGE_LOCAL_DIR: join(tmpdir(), randomUUID()) }));
  await assert.rejects(downloadFile({ db, token, store: wrong, id: file.id }));
  await assert.rejects(deleteFile({ db, token, store: wrong, id: file.id }));
  await store.remove(file.id);
  await store.put(file.id, Buffer.alloc(gpx.length, 32), "application/gpx+xml");
  await assert.rejects(downloadFile({ db, store, token, id: file.id }));
}));

test("HTTP handlers enforce CSRF, private attachment responses and safe infrastructure errors", async () => fixture(async ({ token, store }) => {
  const origin = "https://atlas.example";
  const dependencies = { db, token, store, origin };
  const request = (headers: Record<string, string> = {}) => new Request(`${origin}/api/files?purpose=gpx`, { method: "POST", headers: { "content-type": "application/gpx+xml", ...headers }, body: gpx });
  const rejectedOrigins: Record<string, string>[] = [{}, { origin: "https://foreign.example" }, { origin, "sec-fetch-site": "cross-site" }];
  for (const headers of rejectedOrigins) {
    assert.equal((await handleFileRequest(request(headers), dependencies)).status, 403);
  }
  const response = await handleFileRequest(request({ origin }), dependencies);
  assert.equal(response.status, 201);
  const file = await response.json();
  const downloaded = await handleFileRequest(new Request(`${origin}${file.downloadUrl}`), dependencies, file.id);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("content-type"), "application/octet-stream");
  assert.equal(downloaded.headers.get("cache-control"), "private, no-store");
  assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
  assert.match(downloaded.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), gpx);
  const broken: ObjectStore = { location: store.location, put: (...args) => store.put(...args), remove: (...args) => store.remove(...args), get: async () => { throw new Error("secret key"); } };
  const unavailable = await handleFileRequest(new Request(`${origin}${file.downloadUrl}`), { ...dependencies, store: broken }, file.id);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "unavailable" });
}));

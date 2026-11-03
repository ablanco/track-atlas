import { createAcceptedSession as createSession } from "../helpers/accepted-session";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { after, test, type TestContext } from "node:test";
import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import { users, tracks, storedFiles, sessions } from "../../db/schema";
import { signupFixture } from "./auth-helpers";
import { createTrack } from "../../tracks/service";
import { createGpxStudioUrl, readGpxStudioFile } from "../../tracks/gpx-studio";
import { handleGpxStudioRequest } from "../../tracks/gpx-studio-http";

loadEnvConfig(process.cwd(), true);
const { db, pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
const origin = "https://atlas.example";
const bytes = Buffer.from(
  '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests"><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.01"/></trkseg></trk></gpx>',
);

async function fixture(t: TestContext) {
  const accounts = await db
    .insert(users)
    .values(
      [signupFixture(), signupFixture()].map((u) => ({
        ...u,
        passwordHash: "synthetic",
        emailConfirmed: true,
      })),
    )
    .returning();
  t.after(async () => {
    for (const user of accounts) {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`DELETE FROM track_upload_attempts WHERE owner_id=${user.id}::uuid`,
        );
        await tx.delete(tracks).where(eq(tracks.ownerId, user.id));
      });
      await db.delete(storedFiles).where(eq(storedFiles.ownerId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
  const owner = accounts[0],
    other = accounts[1];
  const token = (await createSession(db, owner.id)).token;
  const otherToken = (await createSession(db, other.id)).token;
  const objects = new Map<string, Buffer>();
  let reads = 0;
  const store = {
    location: "b".repeat(64),
    put: async (key: string, value: Buffer) => {
      objects.set(key, value);
    },
    get: async (key: string) => {
      reads++;
      return objects.get(key) ?? null;
    },
    remove: async (key: string) => {
      objects.delete(key);
    },
  };
  const track = await createTrack({
    db,
    token,
    store,
    read: async () => ({
      requestId: randomUUID(),
      input: {
        name: "ridge",
        description: "ridge",
        activity: "hiking",
        difficulty: 3,
        tags: [],
        visibility: "private",
      },
      bytes,
    }),
  });
  const deps = { db, token, store, origin, id: track.id };
  const editor = (
    sessionToken: string | undefined = token,
    locale: "en" | "es" = "en",
  ) => createGpxStudioUrl({ ...deps, token: sessionToken, locale });
  const file = async () =>
    new URL(JSON.parse(new URL(await editor()).searchParams.get("files")!)[0]);
  return {
    ...deps,
    owner,
    other,
    otherToken,
    editor,
    file,
    reads: () => reads,
    objects,
  };
}
const keyOf = (url: URL) => url.pathname.split("/").at(-2)!;

test("private owners open localized GPX Studio with a scoped capability, never session credentials", async (t) => {
  const f = await fixture(t);
  // Like Download GPX, confirmed email is not required.
  await db
    .update(users)
    .set({ emailConfirmed: false })
    .where(eq(users.id, f.owner.id));
  const editor = new URL(await f.editor(f.token, "es"));
  assert.equal(editor.origin, "https://gpx.studio");
  assert.equal(editor.pathname, "/es/app");
  const file = new URL(JSON.parse(editor.searchParams.get("files")!)[0]);
  assert.equal(file.origin, origin);
  assert.ok(file.pathname.startsWith(`/api/tracks/${f.id}/gpx-studio/`));
  assert.ok(file.pathname.endsWith("/track.gpx"));
  assert.ok(!file.href.includes(f.token));
  assert.ok(
    !file.href.includes(createHash("sha256").update(f.token).digest("hex")),
  );
  const expires = Number(keyOf(file).split(".")[1]);
  assert.ok(expires > Date.now() / 1000 && expires <= Date.now() / 1000 + 600);
  for (let i = 0; i < 2; i++)
    assert.deepEqual(
      await readGpxStudioFile({ ...f, key: keyOf(file) }),
      bytes,
    );
});

test("minting follows download access: guests and other users cannot open private tracks", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    createGpxStudioUrl({ ...f, token: undefined, locale: "en" }),
    { message: "unauthorized" },
  );
  await assert.rejects(f.editor(f.otherToken), { message: "notFound" });
  await db
    .update(tracks)
    .set({ visibility: "public" })
    .where(eq(tracks.id, f.id));
  assert.equal(
    new URL(await f.editor(f.otherToken)).origin,
    "https://gpx.studio",
  );
  await db.update(users).set({ active: false }).where(eq(users.id, f.owner.id));
  await assert.rejects(f.editor(f.otherToken), { message: "notFound" });
});

test("invalid, tampered, expired and other-track capabilities fail before storage reads", async (t) => {
  const f = await fixture(t);
  const key = keyOf(await f.file());
  const [sessionId, expires, mac] = key.split(".");
  const badMac = (mac[0] === "A" ? "B" : "A") + mac.slice(1);
  for (const invalid of [
    "",
    "x".repeat(1000),
    `${sessionId}.${expires}.${badMac}`,
    `${sessionId}.${Number(expires) + 600}.${mac}`,
  ])
    await assert.rejects(readGpxStudioFile({ ...f, key: invalid }), {
      message: "notFound",
    });
  await assert.rejects(readGpxStudioFile({ ...f, id: randomUUID(), key }), {
    message: "notFound",
  });
  const another = await createTrack({
    db,
    token: f.token,
    store: f.store,
    read: async () => ({
      requestId: randomUUID(),
      input: {
        name: "other ridge",
        description: "ridge",
        activity: "hiking",
        difficulty: 3,
        tags: [],
        visibility: "public",
      },
      bytes,
    }),
  });
  await assert.rejects(readGpxStudioFile({ ...f, id: another.id, key }), {
    message: "notFound",
  });
  const past = String(Math.floor(Date.now() / 1000) - 60);
  const expiredMac = createHmac(
    "sha256",
    createHash("sha256").update(f.token).digest(),
  )
    .update(`track-atlas:gpx-studio:v1:${sessionId}:${f.id}:${past}`)
    .digest("base64url");
  await assert.rejects(
    readGpxStudioFile({ ...f, key: `${sessionId}.${past}.${expiredMac}` }),
    { message: "notFound" },
  );
  assert.equal(f.reads(), 0);
});

for (const change of [
  "logout",
  "session expiry",
  "viewer deactivation",
  "owner deactivation",
  "private",
  "delete",
] as const) {
  test(`file access rechecks ${change} after link creation`, async (t) => {
    const f = await fixture(t);
    await db
      .update(tracks)
      .set({ visibility: "public" })
      .where(eq(tracks.id, f.id));
    const editor = new URL(await f.editor(f.otherToken));
    const key = keyOf(
      new URL(JSON.parse(editor.searchParams.get("files")!)[0]),
    );
    const sessionId = key.split(".")[0];
    if (change === "logout")
      await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (change === "session expiry")
      await db
        .update(sessions)
        .set({ expiresAt: sql`clock_timestamp()-interval '1 second'` })
        .where(eq(sessions.id, sessionId));
    if (change === "viewer deactivation")
      await db
        .update(users)
        .set({ active: false })
        .where(eq(users.id, f.other.id));
    if (change === "owner deactivation")
      await db
        .update(users)
        .set({ active: false })
        .where(eq(users.id, f.owner.id));
    if (change === "private")
      await db
        .update(tracks)
        .set({ visibility: "private" })
        .where(eq(tracks.id, f.id));
    if (change === "delete") {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`DELETE FROM track_upload_attempts WHERE track_id=${f.id}::uuid`,
        );
        await tx.delete(tracks).where(eq(tracks.id, f.id));
      });
    }
    await assert.rejects(readGpxStudioFile({ ...f, key }), {
      message: "notFound",
    });
    assert.equal(f.reads(), 0);
  });
}

test("HTTP redirect uses trusted origin; cross-origin file GET needs no cookie and allows only GPX Studio", async (t) => {
  const f = await fixture(t);
  const start = `${origin}/api/tracks/${f.id}/gpx-studio?locale=en`;
  const call = (url: string, headers = {}) =>
    handleGpxStudioRequest(new Request(url, { headers }), f, f.id);
  assert.equal(
    (await call(start, { "sec-fetch-site": "cross-site" })).status,
    403,
  );
  assert.equal(
    (await call(start + "&redirect=https://evil.example")).status,
    400,
  );
  const response = await call(start);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const editor = new URL(response.headers.get("location")!);
  const file = JSON.parse(editor.searchParams.get("files")!)[0];
  const read = (headers = {}, url = file) =>
    handleGpxStudioRequest(
      new Request(url, { headers }),
      { ...f, token: undefined },
      f.id,
      keyOf(new URL(url)),
    );
  const exported = await read({ origin: "https://gpx.studio" });
  assert.equal(exported.status, 200);
  assert.deepEqual(Buffer.from(await exported.arrayBuffer()), bytes);
  assert.equal(
    exported.headers.get("access-control-allow-origin"),
    "https://gpx.studio",
  );
  assert.equal(exported.headers.get("access-control-allow-credentials"), null);
  assert.equal(exported.headers.get("cache-control"), "private, no-store");
  assert.equal((await read({ origin: "https://evil.example" })).status, 404);
  assert.equal((await read({}, file + "?key=x")).status, 404);
  assert.equal(
    (await read({}, file.replace(keyOf(new URL(file)), "invalid"))).status,
    404,
  );
});

test("exports check original GPX integrity and configured storage", async (t) => {
  const f = await fixture(t);
  const key = keyOf(await f.file());
  await assert.rejects(
    readGpxStudioFile({
      ...f,
      key,
      store: { ...f.store, location: "c".repeat(64) },
    }),
    { message: "unavailable" },
  );
  for (const objectKey of f.objects.keys())
    f.objects.set(objectKey, Buffer.from("broken"));
  await assert.rejects(readGpxStudioFile({ ...f, key }), {
    message: "unavailable",
  });
});

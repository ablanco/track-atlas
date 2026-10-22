import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test, type TestContext } from "node:test";
import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import {
  users,
  tracks,
  storedFiles,
  trackData,
  trackTags,
} from "../../db/schema";
import { createSession, revokeSession } from "../../auth/session-store";
import { authTransaction, signupFixture } from "./auth-helpers";
import { handleExploreRequest } from "../../tracks/explore-http";
import { getTrackData } from "../../tracks/service";
import { parseExploreFilters } from "../../tracks/explore-query";
import {
  getExploreResults,
  getExploreGeometry,
  downloadCollectionAvatar,
} from "../../tracks/explore";

loadEnvConfig(process.cwd(), true);
const { pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
async function fixture(t: TestContext) {
  const { db, client } = await authTransaction(t, pool);
  const [owner, other] = await db
    .insert(users)
    .values(
      [signupFixture(), signupFixture()].map((value) => ({
        ...value,
        passwordHash: "synthetic",
      })),
    )
    .returning();
  const token = (await createSession(db, owner.id)).token;
  const add = async (
    values: Partial<typeof tracks.$inferInsert> = {},
    tags: string[] = [],
    status: "ready" | "pending" = "ready",
  ) => {
    const fileId = randomUUID();
    const [file] = await db
      .insert(storedFiles)
      .values({
        id: fileId,
        ownerId: owner.id,
        purpose: "gpx",
        objectKey: fileId,
        storageLocation: "b".repeat(64),
        byteSize: 1,
        status,
        contentType: "application/gpx+xml",
        sha256: "a".repeat(64),
      })
      .returning();
    const [track] = await db
      .insert(tracks)
      .values({
        ownerId: owner.id,
        originalFileId: file.id,
        requestId: randomUUID(),
        name: "Peña ridge",
        description: "Not searchable volcano",
        activity: "hiking",
        difficulty: 3,
        visibility: "public",
        pointCount: 3,
        distanceMeters: 1250,
        minElevationMeters: 10,
        maxElevationMeters: 52.5,
        elevationSampleCount: 3,
        ascentMeters: 42.5,
        descentMeters: 0,
        version: 1,
        ...values,
      })
      .returning();
    await db.insert(trackData).values({
      trackId: track.id,
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [0.01, 0.01],
          [0.02, 0],
        ],
      },
      samples: [
        { distanceMeters: 0, elevationMeters: 10, speedMps: null },
        { distanceMeters: 625, elevationMeters: 52.5, speedMps: null },
        { distanceMeters: 1250, elevationMeters: 10, speedMps: null },
      ],
    });
    if (tags.length)
      await db.insert(trackTags).values(
        tags.map((label, ordinal) => ({
          trackId: track.id,
          label,
          normalizedKey: label.toLowerCase(),
          ordinal,
        })),
      );
    return track;
  };
  const read = (
    query = "",
    session: string | undefined = undefined,
    ownerId: string | undefined = owner.id,
  ) =>
    getExploreResults({
      db,
      token: session,
      ownerId,
      filters: parseExploreFilters(new URLSearchParams(query)),
    });
  return { db, client, owner, other, token, add, read };
}

test("public browsing and collections reveal only authorized tracks, bounds and safe identity", async (t) => {
  const f = await fixture(t);
  const publicTrack = await f.add();
  await f.add({
    visibility: "private",
    distanceMeters: 9000,
    maxElevationMeters: 999,
  });
  const guest = await f.read("visibility=private");
  assert.equal(guest?.total, 1);
  assert.equal(guest?.scopeCount, 1);
  assert.deepEqual(
    guest?.tracks.map((track) => track.id),
    [publicTrack.id],
  );
  assert.deepEqual(guest?.bounds, {
    maxDistanceKm: 1.25,
    maxElevationRangeMeters: 42.5,
  });
  assert.deepEqual(guest?.collection, {
    id: f.owner.id,
    name: "Ada L.",
    avatarUrl: null,
    isOwner: false,
  });
  const own = await f.read("", f.token);
  assert.equal(own?.total, 2);
  assert.equal(own?.collection?.isOwner, true);
  const publicSearch = await getExploreResults({
    db: f.db,
    token: f.token,
    filters: parseExploreFilters(new URLSearchParams()),
  });
  assert.equal(
    publicSearch?.tracks.some((track) => track.visibility === "private"),
    false,
  );
});

test("every case/accent-insensitive query word matches title or tags as a literal substring", async (t) => {
  const f = await fixture(t);
  const match = await f.add({}, ["BÓSQUE", "100%_\\path"]);
  await f.add({ name: "Other ridge" }, ["forest"]);
  for (const query of ["PEna bosq", "peña ridge", "100%_\\path"]) {
    assert.deepEqual(
      (await f.read(new URLSearchParams({ q: query }).toString()))?.tracks.map(
        (value) => value.id,
      ),
      [match.id],
    );
  }
  assert.equal((await f.read("q=volcano"))?.total, 0);
  assert.equal((await f.read("q=pena+missing"))?.total, 0);
});

test("alternative choices intersect categories and exact inclusive limits require complete elevation only when active", async (t) => {
  const f = await fixture(t);
  const exact = await f.add();
  const walking = await f.add({
    activity: "walking",
    difficulty: 5,
    distanceMeters: 1250.001,
    maxElevationMeters: 52.500001,
  });
  const partial = await f.add({
    elevationSampleCount: 2,
    ascentMeters: null,
    descentMeters: null,
  });
  const absent = await f.add({
    elevationSampleCount: 0,
    minElevationMeters: null,
    maxElevationMeters: null,
    ascentMeters: null,
    descentMeters: null,
  });
  assert.equal(
    (await f.read("activity=hiking&activity=walking&difficulty=3&difficulty=5"))
      ?.total,
    4,
  );
  assert.equal((await f.read("activity=walking&difficulty=3"))?.total, 0);
  assert.deepEqual(
    (
      await f.read("minDistance=1.25&maxDistance=1.25&maxElevationRange=42.5")
    )?.tracks.map((value) => value.id),
    [exact.id],
  );
  assert.equal(
    (await f.read("minDistance=1.250001"))?.tracks[0].id,
    walking.id,
  );
  const unrestricted = await f.read();
  assert.equal(
    unrestricted?.tracks.some((value) => value.id === partial.id),
    true,
  );
  assert.equal(
    unrestricted?.tracks.some((value) => value.id === absent.id),
    true,
  );
  assert.deepEqual((await f.read("q=no-match"))?.bounds, unrestricted?.bounds);
  assert.equal((await f.read("q=no-match"))?.scopeCount, 4);
});

test("pages contain ten newest uploads with stable ID ties, clamp after filtering and preserve scope bounds", async (t) => {
  const f = await fixture(t);
  const ids: string[] = [];
  for (let i = 0; i < 12; i++)
    ids.push(
      (
        await f.add({
          createdAt: new Date("2026-01-01"),
          visibility: i < 2 ? "private" : "public",
        })
      ).id,
    );
  ids.sort().reverse();
  const first = await f.read("", f.token);
  assert.deepEqual(
    first?.tracks.map((value) => value.id),
    ids.slice(0, 10),
  );
  assert.equal(first?.pageCount, 2);
  const last = await f.read("page=999", f.token);
  assert.deepEqual(
    last?.tracks.map((value) => value.id),
    ids.slice(10),
  );
  assert.equal(last?.page, 2);
  assert.equal(last?.filters.page, 2);
  const privateOnly = await f.read("visibility=private&page=999", f.token);
  assert.equal(privateOnly?.total, 2);
  assert.equal(privateOnly?.scopeCount, 12);
  assert.equal(privateOnly?.page, 1);
  assert.equal((await f.read("visibility=public", f.token))?.total, 10);
  assert.deepEqual(privateOnly?.bounds, first?.bounds);
  const empty = await f.read("q=absent&page=999", f.token);
  assert.equal(empty?.page, 1);
  assert.equal(empty?.pageCount, 1);
  assert.equal(empty?.scopeCount, 12);
});

test("explorer geometry preserves bends and endpoints without returning samples or directional paths", async (t) => {
  const f = await fixture(t);
  const track = await f.add();
  assert.deepEqual(
    await getExploreGeometry({ db: f.db, token: undefined, id: track.id }),
    {
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [0.01, 0.01],
          [0.02, 0],
        ],
      },
    },
  );
  await f.db
    .update(tracks)
    .set({ visibility: "private" })
    .where(eq(tracks.id, track.id));
  assert.equal(
    await getExploreGeometry({ db: f.db, token: undefined, id: track.id }),
    null,
  );
  assert.notEqual(
    await getExploreGeometry({ db: f.db, token: f.token, id: track.id }),
    null,
  );
});

test("a full page of 100000-point paths has bounded display transfer and unchanged recorded geometry", async (t) => {
  const f = await fixture(t);
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const track = await f.add({
      pointCount: 100000,
      elevationSampleCount: 0,
      minElevationMeters: null,
      maxElevationMeters: null,
      ascentMeters: null,
      descentMeters: null,
    });
    ids.push(track.id);
    await f.db.execute(
      sql`UPDATE track_data SET geometry=(SELECT ST_SetSRID(ST_MakeLine(ST_MakePoint(n*0.00001,sin(n/3.0)*0.001) ORDER BY n),4326) FROM generate_series(0,99999) n),samples=(SELECT jsonb_agg(jsonb_build_object('distanceMeters',n,'elevationMeters',null,'speedMps',null)) FROM generate_series(0,99999) n) WHERE track_id=${track.id}::uuid`,
    );
  }
  const start = performance.now();
  let bytes = 0;
  for (const id of ids) {
    const display = await getExploreGeometry({
      db: f.db,
      token: undefined,
      id,
    });
    assert.ok(display);
    assert.ok(
      display.geometry.coordinates.length <= 2048,
      `display has ${display.geometry.coordinates.length} vertices`,
    );
    assert.deepEqual(display.geometry.coordinates[0], [0, 0]);
    bytes += Buffer.byteLength(JSON.stringify(display));
  }
  t.diagnostic(
    `10 x 100000-point geometry: ${Math.round(performance.now() - start)}ms, ${bytes} bytes`,
  );
  const recorded = await getTrackData({
    db: f.db,
    token: undefined,
    id: ids[0],
  });
  assert.equal(recorded?.geometry.coordinates.length, 100000);
  assert.equal(recorded?.samples.length, 100000);
});

test("foreign, expired and revoked sessions cannot expand a collection; inactive and unknown owners are missing", async (t) => {
  const f = await fixture(t);
  await f.add({ visibility: "private" });
  const foreign = (await createSession(f.db, f.other.id)).token;
  assert.equal((await f.read("visibility=private", foreign))?.total, 0);
  const empty = await f.read("", undefined, f.other.id);
  assert.equal(empty?.scopeCount, 0);
  assert.equal(empty?.collection?.id, f.other.id);
  assert.equal(await f.read("", undefined, randomUUID()), null);
  assert.equal(await f.read("", undefined, "bad-id"), null);
  await revokeSession(f.db, f.token);
  assert.equal((await f.read("", f.token))?.total, 0);
  const expired = (await createSession(f.db, f.owner.id)).token;
  await f.db.execute(
    sql`UPDATE sessions SET expires_at=statement_timestamp()-interval '1 second' WHERE user_id=${f.owner.id}::uuid`,
  );
  assert.equal((await f.read("", expired))?.total, 0);
  await f.db
    .update(users)
    .set({ active: false })
    .where(eq(users.id, f.owner.id));
  assert.equal(await f.read("", expired), null);
});

test("read-only HTTP returns validated no-store results and safe errors without requiring object storage", async (t) => {
  const f = await fixture(t);
  const track = await f.add();
  const request = (query: string, method = "GET") =>
    new Request(`http://localhost/api/tracks/explore${query}`, { method });
  const deps = { db: f.db, token: undefined };
  const response = await handleExploreRequest(
    request(`?ownerId=${f.owner.id}`),
    deps,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  const body = await response.json();
  assert.equal(body.tracks[0].id, track.id);
  assert.equal(JSON.stringify(body).includes(f.owner.email), false);
  for (const query of [
    "?ownerId=bad",
    `?ownerId=${f.owner.id}&ownerId=${f.other.id}`,
    "?page=-1",
    "?unknown=x",
  ]) {
    const failure = await handleExploreRequest(request(query), deps);
    assert.equal(failure.status, 400, query);
    assert.deepEqual(await failure.json(), { error: "invalidRequest" });
    assert.match(failure.headers.get("cache-control")!, /no-store/);
  }
  assert.equal(
    (await handleExploreRequest(request(`?ownerId=${randomUUID()}`), deps))
      .status,
    404,
  );
  assert.equal(
    (await handleExploreRequest(request("", "POST"), deps)).status,
    405,
  );
  const geometry = await handleExploreRequest(
    new Request(`http://localhost/api/tracks/${track.id}/explore-geometry`),
    deps,
    { resource: "geometry", id: track.id },
  );
  assert.equal(geometry.status, 200);
  assert.deepEqual(Object.keys(await geometry.json()), ["geometry"]);
});

test("empty public collections deliver only the current derived avatar and reject corruption or association changes", async (t) => {
  const f = await fixture(t);
  const fileId = randomUUID();
  const original = Buffer.from("original-profile-bytes"),
    derived = Buffer.from("derived-webp");
  const hash = (value: Buffer) =>
    createHash("sha256").update(value).digest("hex");
  const location = "b".repeat(64);
  await f.db.insert(storedFiles).values({
    id: fileId,
    ownerId: f.owner.id,
    purpose: "avatar",
    status: "ready",
    objectKey: `avatars/original/${fileId}`,
    storageLocation: location,
    byteSize: original.length,
    contentType: "image/png",
    sha256: hash(original),
    avatar128Bytes: derived.length,
    avatar128Sha256: hash(derived),
    avatar24Bytes: derived.length,
    avatar24Sha256: hash(derived),
  });
  await f.db
    .update(users)
    .set({ avatarFileId: fileId })
    .where(eq(users.id, f.owner.id));
  const store = {
    location,
    put: async () => {},
    remove: async () => {},
    get: async (key: string) =>
      key === `avatars/128/${fileId}` ? derived : original,
  };
  assert.equal(
    (await f.read())?.collection?.avatarUrl,
    `/api/users/${f.owner.id}/avatar`,
  );
  assert.deepEqual(
    (await downloadCollectionAvatar({ db: f.db, ownerId: f.owner.id, store }))
      .bytes,
    derived,
  );
  const response = await handleExploreRequest(
    new Request(`http://localhost/api/users/${f.owner.id}/avatar`),
    { db: f.db, token: undefined, store },
    { resource: "avatar", id: f.owner.id },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), derived);
  await assert.rejects(
    downloadCollectionAvatar({
      db: f.db,
      ownerId: f.owner.id,
      store: { ...store, get: async () => original },
    }),
    { message: "unavailable" },
  );
  await assert.rejects(
    downloadCollectionAvatar({
      db: f.db,
      ownerId: f.owner.id,
      store: {
        ...store,
        get: async () => {
          await f.db
            .update(users)
            .set({ avatarFileId: null })
            .where(eq(users.id, f.owner.id));
          return derived;
        },
      },
    }),
    { message: "notFound" },
  );
  await f.db
    .update(users)
    .set({ avatarFileId: fileId, active: false })
    .where(eq(users.id, f.owner.id));
  await assert.rejects(
    downloadCollectionAvatar({ db: f.db, ownerId: f.owner.id, store }),
    { message: "notFound" },
  );
});

test("very small closed recorded paths still return a usable LineString", async (t) => {
  const f = await fixture(t);
  const track = await f.add();
  await f.db
    .update(trackData)
    .set({
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [0.00000001, 0],
          [0, 0],
        ],
      },
    })
    .where(eq(trackData.trackId, track.id));
  const data = await getExploreGeometry({
    db: f.db,
    token: undefined,
    id: track.id,
  });
  assert.equal(data?.geometry?.type, "LineString");
  assert.ok(data.geometry.coordinates.length >= 2);
});

test("unpublished originals and inactive accounts reveal neither metadata nor geometry", async (t) => {
  const f = await fixture(t);
  const pending = await f.add({}, [], "pending");
  assert.equal((await f.read("", f.token))?.scopeCount, 0);
  assert.equal(
    await getExploreGeometry({ db: f.db, token: f.token, id: pending.id }),
    null,
  );
  const ready = await f.add();
  assert.equal((await f.read())?.total, 1);
  await f.db
    .update(users)
    .set({ active: false })
    .where(eq(users.id, f.owner.id));
  assert.equal(
    await getExploreGeometry({ db: f.db, token: f.token, id: ready.id }),
    null,
  );
  const response = await handleExploreRequest(
    new Request("http://localhost/api/tracks/explore"),
    { db: f.db, token: f.token },
    { resource: "geometry", id: ready.id },
  );
  assert.equal(response.status, 404);
});

test("display simplification preserves long world traversal and dateline bends", async (t) => {
  const f = await fixture(t);
  const track = await f.add();
  await f.db
    .update(trackData)
    .set({
      geometry: {
        type: "LineString",
        coordinates: [
          [-170, 0],
          [-10, 0],
          [150, 0],
        ],
      },
    })
    .where(eq(trackData.trackId, track.id));
  const data = await getExploreGeometry({
    db: f.db,
    token: undefined,
    id: track.id,
  });
  assert.ok(data);
  let longitude = data.geometry.coordinates[0][0];
  for (const [x] of data.geometry.coordinates.slice(1))
    longitude = x + 360 * Math.round((longitude - x) / 360);
  assert.equal(
    longitude,
    150,
    "map wrapping must follow the recorded 320-degree eastward journey",
  );
  await f.db
    .update(trackData)
    .set({
      geometry: {
        type: "LineString",
        coordinates: [
          [179, 89],
          [180, 90],
          [-179, 89],
        ],
      },
    })
    .where(eq(trackData.trackId, track.id));
  const polar = await getExploreGeometry({
    db: f.db,
    token: undefined,
    id: track.id,
  });
  assert.deepEqual(polar?.geometry.coordinates, [
    [179, 89],
    [180, 90],
    [-179, 89],
  ]);
});

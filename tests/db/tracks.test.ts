import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { PoolClient } from "pg";
import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import {
  users,
  storedFiles,
  tracks,
  trackUploadAttempts,
} from "../../db/schema";
import { createSession, revokeSession } from "../../auth/session-store";
import { signupFixture } from "./auth-helpers";
import { getStorageConfig } from "../../storage/config";
import { createObjectStore, type ObjectStore } from "../../storage/objects";
import {
  createTrack,
  getTrack,
  getTrackData,
  getTrackSamples,
  downloadTrack,
} from "../../tracks/service";
import { TrackError } from "../../tracks/validation";
import { deleteFile, cleanupFiles } from "../../storage/files";
import { handleTrackRequest } from "../../tracks/http";

loadEnvConfig(process.cwd(), true);
const { db, pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
const gpx = Buffer.from(
  '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests"><trk><trkseg><trkpt lat="0" lon="0"><ele>10</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="0" lon="0.01"><ele>20</ele><time>2026-01-01T00:01:00Z</time></trkpt></trkseg></trk></gpx>',
);
const input = {
  name: "Test track",
  description: "Two recorded points",
  activity: "hiking",
  difficulty: 3,
  tags: ["forest"],
};
async function fixture(
  work: (ctx: {
    userId: string;
    token: string;
    store: ObjectStore;
  }) => Promise<void>,
) {
  const [user] = await db
    .insert(users)
    .values({
      ...signupFixture(),
      passwordHash: "synthetic",
      emailConfirmed: true,
    })
    .returning();
  const directory = await mkdtemp(join(tmpdir(), "atlas-track-db-"));
  const store = createObjectStore(
    getStorageConfig({
      NODE_ENV: "development",
      FILE_STORAGE_LOCAL_DIR: directory,
    }),
  );
  try {
    await work({
      userId: user.id,
      token: (await createSession(db, user.id)).token,
      store,
    });
  } finally {
    await db.transaction(async (tx) => {
      await tx
        .delete(trackUploadAttempts)
        .where(eq(trackUploadAttempts.ownerId, user.id));
      await tx.delete(tracks).where(eq(tracks.ownerId, user.id));
    });
    await db.delete(storedFiles).where(eq(storedFiles.ownerId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
    await rm(directory, { recursive: true, force: true });
  }
}
const code = (value: string) => (error: unknown) =>
  error instanceof TrackError && error.code === value;
const upload = (
  ctx: { token: string | undefined; store: ObjectStore },
  requestId = randomUUID(),
  overrides: Partial<Parameters<typeof createTrack>[0]> = {},
) =>
  createTrack({
    db,
    ...ctx,
    read: async () => ({ requestId, input, bytes: gpx }),
    ...overrides,
  });
for (const kind of [
  "missing",
  "malformed",
  "revoked",
  "inactive",
  "unconfirmed",
] as const)
  test(`upload rejects ${kind} eligibility before reading the body`, async () =>
    fixture(async (ctx) => {
      if (kind === "revoked") await revokeSession(db, ctx.token);
      if (kind === "inactive")
        await db
          .update(users)
          .set({ active: false })
          .where(eq(users.id, ctx.userId));
      if (kind === "unconfirmed")
        await db
          .update(users)
          .set({ emailConfirmed: false })
          .where(eq(users.id, ctx.userId));
      let read = false;
      await assert.rejects(
        upload(
          {
            ...ctx,
            token:
              kind === "missing"
                ? undefined
                : kind === "malformed"
                  ? "invalid"
                  : ctx.token,
          },
          randomUUID(),
          {
            read: async () => {
              read = true;
              return { requestId: randomUUID(), input, bytes: gpx };
            },
          },
        ),
        code(kind === "unconfirmed" ? "emailUnconfirmed" : "unauthorized"),
      );
      assert.equal(read, false);
    }));
test("HTTP creation rejects foreign origins before consuming the body", async () =>
  fixture(async (ctx) => {
    const origin = "https://atlas.example";
    const rejectedHeaders: Record<string, string>[] = [
      {},
      { origin: "https://foreign.example" },
      { origin, "sec-fetch-site": "cross-site" },
    ];
    for (const headers of rejectedHeaders) {
      const request = new Request(`${origin}/api/tracks`, {
        method: "POST",
        headers,
        body: "not multipart",
      });
      const response = await handleTrackRequest(request, {
        db,
        ...ctx,
        origin,
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "forbidden" });
      assert.equal(request.bodyUsed, false);
    }
  }));
test("private details, data and original hide foreign, missing and inactive resources", async () =>
  fixture(async (ctx) => {
    const { id } = await upload(ctx);
    await fixture(async (other) => {
      for (const token of [undefined, other.token])
        for (const candidate of [id, randomUUID(), "bad-id"]) {
          assert.equal(await getTrack({ db, token, id: candidate }), null);
          assert.equal(await getTrackData({ db, token, id: candidate }), null);
          assert.equal(
            await getTrackSamples({ db, token, id: candidate }),
            null,
          );
          await assert.rejects(
            downloadTrack({ db, store: ctx.store, token, id: candidate }),
            code("notFound"),
          );
        }
    });
    await db
      .update(users)
      .set({ active: false })
      .where(eq(users.id, ctx.userId));
    assert.equal(await getTrack({ db, token: ctx.token, id }), null);
    assert.equal(await getTrackData({ db, token: ctx.token, id }), null);
    assert.equal(await getTrackSamples({ db, token: ctx.token, id }), null);
    await assert.rejects(downloadTrack({ db, ...ctx, id }), code("notFound"));
  }));
for (const change of ["revoked", "unconfirmed"] as const)
  test(`publication rechecks ${change} eligibility after object write`, async () =>
    fixture(async (ctx) => {
      const requestId = randomUUID();
      const interrupted: ObjectStore = {
        ...ctx.store,
        put: async (...args) => {
          await ctx.store.put(...args);
          if (change === "revoked") await revokeSession(db, ctx.token);
          else
            await db
              .update(users)
              .set({ emailConfirmed: false })
              .where(eq(users.id, ctx.userId));
        },
      };
      await assert.rejects(
        upload({ ...ctx, store: interrupted }, requestId),
        code(change === "revoked" ? "unauthorized" : "emailUnconfirmed"),
      );
      await db
        .update(users)
        .set({ emailConfirmed: true })
        .where(eq(users.id, ctx.userId));
      const token = (await createSession(db, ctx.userId)).token;
      const recovered = await upload({ ...ctx, token }, requestId);
      assert.ok(await getTrack({ db, token, id: recovered.id }));
      assert.deepEqual(
        (await downloadTrack({ db, ...ctx, token, id: recovered.id })).bytes,
        gpx,
      );
    }));
test("concurrent retries stay pending, bind payload and recover the same result", async () =>
  fixture(async (ctx) => {
    const requestId = randomUUID(),
      started = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const blocked: ObjectStore = {
      ...ctx.store,
      put: async (...args) => {
        started.resolve();
        await release.promise;
        await ctx.store.put(...args);
      },
    };
    const first = upload({ ...ctx, store: blocked }, requestId);
    try {
      await started.promise;
      await assert.rejects(upload(ctx, requestId), code("processing"));
      await assert.rejects(
        upload(ctx, requestId, {
          read: async () => ({
            requestId,
            input: { ...input, name: "Different" },
            bytes: gpx,
          }),
        }),
        code("conflict"),
      );
    } finally {
      release.resolve();
    }
    const result = await first;
    assert.deepEqual(await upload(ctx, requestId), result);
    assert.notEqual((await upload(ctx)).id, result.id);
  }));
test("a failed object write can retry the same logical request", async () =>
  fixture(async (ctx) => {
    const requestId = randomUUID();
    const failing: ObjectStore = {
      ...ctx.store,
      put: async () => {
        throw new Error("private object-store credentials");
      },
    };
    await assert.rejects(upload({ ...ctx, store: failing }, requestId));
    const result = await upload(ctx, requestId);
    assert.deepEqual(
      (await downloadTrack({ db, ...ctx, id: result.id })).bytes,
      gpx,
    );
    assert.deepEqual(await upload(ctx, requestId), result);
  }));
test("an expired attempt cannot publish or remove its replacement original", async () =>
  fixture(async (ctx) => {
    const requestId = randomUUID(),
      started = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const blocked: ObjectStore = {
      ...ctx.store,
      put: async (...args) => {
        await ctx.store.put(...args);
        started.resolve();
        await release.promise;
      },
    };
    const stale = upload({ ...ctx, store: blocked }, requestId);
    const rejected = assert.rejects(stale, code("conflict"));
    let replacement: { id: string } | undefined;
    try {
      await started.promise;
      await db
        .update(storedFiles)
        .set({ expiresAt: sql`clock_timestamp()-interval '1 second'` })
        .where(eq(storedFiles.ownerId, ctx.userId));
      replacement = await upload(ctx, requestId);
    } finally {
      release.resolve();
    }
    await rejected;
    assert.ok(replacement);
    assert.deepEqual(await upload(ctx, requestId), replacement);
    assert.deepEqual(
      (await downloadTrack({ db, ...ctx, id: replacement.id })).bytes,
      gpx,
    );
  }));
test("database constraints prevent incomplete publication and foreign original attachment", async () =>
  fixture(async (ctx) => {
    const { id } = await upload(ctx);
    await assert.rejects(
      db.execute(
        sql`DELETE FROM track_directional_representations WHERE track_id=${id} AND intermediate_count=5`,
      ),
    );
    await assert.rejects(
      db.execute(sql`DELETE FROM track_data WHERE track_id=${id}`),
    );
    await fixture(async (other) => {
      await assert.rejects(
        db
          .update(tracks)
          .set({ ownerId: other.userId })
          .where(eq(tracks.id, id)),
      );
    });
    await assert.rejects(
      db.update(tracks).set({ difficulty: 6 }).where(eq(tracks.id, id)),
    );
    await assert.rejects(
      db
        .update(tracks)
        .set({ distanceMeters: Infinity })
        .where(eq(tracks.id, id)),
    );
    assert.ok(await getTrackData({ db, token: ctx.token, id }));
  }));
for (const limit of ["pending", "count", "bytes"] as const)
  test(`Track uploads respect shared account ${limit} quota`, async () =>
    fixture(async (ctx) => {
      await db.insert(storedFiles).values(
        Array.from(
          { length: limit === "pending" ? 2 : limit === "count" ? 100 : 25 },
          () => {
            const id = randomUUID();
            return {
              id,
              objectKey: id,
              ownerId: ctx.userId,
              purpose: "gpx" as const,
              status:
                limit === "pending" ? ("pending" as const) : ("ready" as const),
              storageLocation: ctx.store.location,
              byteSize: limit === "count" ? 1 : 10 * 1024 * 1024,
              contentType: limit === "pending" ? null : "application/gpx+xml",
              sha256: limit === "pending" ? null : "a".repeat(64),
            };
          },
        ),
      );
      let written = false;
      const store: ObjectStore = {
        ...ctx.store,
        put: async () => {
          written = true;
        },
      };
      await assert.rejects(upload({ ...ctx, store }), code("quotaExceeded"));
      assert.equal(written, false);
    }));
test("generic file deletion and cleanup cannot remove an attached original", async () =>
  fixture(async (ctx) => {
    let originalId = "";
    const store: ObjectStore = {
      ...ctx.store,
      put: async (key, ...args) => {
        originalId = key;
        await ctx.store.put(key, ...args);
      },
    };
    const { id } = await upload({ ...ctx, store });
    await assert.rejects(deleteFile({ db, ...ctx, id: originalId }));
    await cleanupFiles({ db, store: ctx.store });
    assert.ok(await getTrack({ db, token: ctx.token, id }));
    assert.deepEqual((await downloadTrack({ db, ...ctx, id })).bytes, gpx);
  }));
test("a lost PostgreSQL commit acknowledgement preserves the published original for retry", async () =>
  fixture(async (ctx) => {
    const requestId = randomUUID();
    let armed = false,
      lost = false;
    const originals = new Map<PoolClient, PoolClient["query"]>();
    // Fault the real pg protocol boundary after PostgreSQL has committed, not Drizzle operations.
    const acquire = (client: PoolClient) => {
      if (originals.has(client)) return;
      originals.set(client, client.query);
      client.query = new Proxy(client.query, {
        apply(target, thisArg, args) {
          const statement =
            typeof args[0] === "string" ? args[0] : args[0]?.text;
          const result = Reflect.apply(target, thisArg, args);
          if (
            armed &&
            !lost &&
            typeof statement === "string" &&
            statement.trim().toLowerCase() === "commit"
          ) {
            lost = true;
            return Promise.resolve(result).then(() => {
              throw new Error("lost PostgreSQL commit acknowledgement");
            });
          }
          return result;
        },
      });
    };
    pool.on("acquire", acquire);
    try {
      const store: ObjectStore = {
        ...ctx.store,
        put: async (...args) => {
          await ctx.store.put(...args);
          armed = true;
        },
      };
      await assert.rejects(upload({ ...ctx, store }, requestId));
      assert.equal(lost, true);
    } finally {
      pool.off("acquire", acquire);
      for (const [client, query] of originals) client.query = query;
    }
    await cleanupFiles({ db, store: ctx.store });
    const result = await upload(ctx, requestId);
    assert.ok(await getTrack({ db, token: ctx.token, id: result.id }));
    assert.deepEqual(
      (await downloadTrack({ db, ...ctx, id: result.id })).bytes,
      gpx,
    );
    assert.deepEqual(await upload(ctx, requestId), result);
  }));
test("direct SQL maintains audit timestamps and the five complete Directional representations", async () =>
  fixture(async (ctx) => {
    const { id } = await upload(ctx);
    const variants = await db.execute(
      sql`SELECT intermediate_count, ST_NPoints(geometry) AS points FROM track_directional_representations WHERE track_id=${id} ORDER BY intermediate_count`,
    );
    assert.deepEqual(variants.rows, [
      { intermediate_count: 0, points: 2 },
      { intermediate_count: 1, points: 3 },
      { intermediate_count: 3, points: 5 },
      { intermediate_count: 4, points: 6 },
      { intermediate_count: 5, points: 7 },
    ]);
    for (const table of [
      "tracks",
      "track_data",
      "track_tags",
      "track_directional_representations",
      "track_upload_attempts",
    ]) {
      const name = sql.raw(table),
        key = sql.raw(table === "tracks" ? "id" : "track_id");
      const before = await db.execute(
        sql`SELECT created_at,updated_at FROM ${name} WHERE ${key}=${id} ORDER BY created_at`,
      );
      await db.execute(sql`SELECT pg_sleep(0.005)`);
      const after = await db.execute(
        sql`UPDATE ${name} SET updated_at=updated_at WHERE ${key}=${id} RETURNING created_at,updated_at`,
      );
      assert.equal(after.rows.length, before.rows.length);
      assert.ok(before.rows.length > 0);
      for (const row of after.rows) {
        assert.ok(Number.isFinite(Date.parse(String(row.created_at))));
        assert.ok(
          Date.parse(String(row.updated_at)) >
            Date.parse(String(before.rows[0].updated_at)),
          table,
        );
      }
    }
  }));
test("public Track data preserves repeated recorded positions and missing sample gaps", async () =>
  fixture(async (ctx) => {
    const bytes = Buffer.from(
      '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests"><trk><trkseg><trkpt lat="40" lon="-3"><ele>10</ele></trkpt><trkpt lat="40" lon="-3"/><trkpt lat="40.01" lon="-3.01"><ele>20</ele></trkpt><trkpt lat="40.02" lon="-3.02"/></trkseg></trk></gpx>',
    );
    const { id } = await upload(ctx, randomUUID(), {
      read: async () => ({ requestId: randomUUID(), input, bytes }),
    });
    const data = await getTrackData({ db, token: ctx.token, id });
    assert.deepEqual(
      await getTrackSamples({ db, token: ctx.token, id }),
      data?.samples,
    );
    assert.deepEqual(data?.geometry, {
      type: "LineString",
      coordinates: [
        [-3, 40],
        [-3, 40],
        [-3.01, 40.01],
        [-3.02, 40.02],
      ],
    });
    assert.deepEqual(
      data?.samples.map((sample) => sample.elevationMeters),
      [10, null, 20, null],
    );
    assert.deepEqual(
      data?.samples.map((sample) => sample.speedMps),
      [null, null, null, null],
    );
    assert.deepEqual((await downloadTrack({ db, ...ctx, id })).bytes, bytes);
  }));
for (const coverage of ["complete", "partial", "missing"] as const)
  test(`details expose full-data metrics with ${coverage} elevation`, async () =>
    fixture(async (ctx) => {
      const bytes =
        coverage === "complete"
          ? gpx
          : Buffer.from(
              gpx
                .toString()
                .replace(
                  coverage === "partial"
                    ? /<ele>20<\/ele>/g
                    : /<ele>[^<]*<\/ele>/g,
                  "",
                ),
            );
      const { id } = await upload(ctx, randomUUID(), {
        read: async () => ({ requestId: randomUUID(), input, bytes }),
      });
      const details = await getTrack({ db, token: ctx.token, id });
      assert.ok(details);
      assert.ok(Math.abs(details.distanceMeters - 1113.194908) < 0.001);
      assert.equal(details.durationSeconds, 60);
      assert.equal(details.ascentMeters, coverage === "complete" ? 10 : null);
      assert.equal(details.descentMeters, coverage === "complete" ? 0 : null);
      assert.equal(
        details.minElevationMeters,
        coverage === "missing" ? null : 10,
      );
      assert.equal(
        details.maxElevationMeters,
        coverage === "complete" ? 20 : coverage === "partial" ? 10 : null,
      );
      assert.equal(
        details.elevationSampleCount,
        coverage === "complete" ? 2 : coverage === "partial" ? 1 : 0,
      );
      assert.equal(details.pointCount, 2);
    }));
test("original integrity rejects different bytes of the same length", async () =>
  fixture(async (ctx) => {
    const { id } = await upload(ctx);
    const corrupt: ObjectStore = {
      ...ctx.store,
      get: async () => Buffer.alloc(gpx.length, 32),
    };
    await assert.rejects(
      downloadTrack({ db, ...ctx, store: corrupt, id }),
      code("unavailable"),
    );
    const response = await handleTrackRequest(
      new Request(`https://atlas.example/api/tracks/${id}/download`),
      { db, ...ctx, store: corrupt, origin: "https://atlas.example" },
      id,
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "unavailable" });
  }));
test("HTTP multipart enforces actual file size without a declared Content-Length", async () =>
  fixture(async (ctx) => {
    const origin = "https://atlas.example",
      form = new FormData();
    for (const [key, value] of Object.entries({
      ...input,
      difficulty: String(input.difficulty),
      tags: JSON.stringify(input.tags),
      requestId: randomUUID(),
    }))
      form.set(key, value);
    form.set(
      "file",
      new Blob([Buffer.alloc(10 * 1024 * 1024 + 1, 32)], {
        type: "application/gpx+xml",
      }),
      "too-large.gpx",
    );
    const response = await handleTrackRequest(
      new Request(`${origin}/api/tracks`, {
        method: "POST",
        headers: { origin },
        body: form,
      }),
      { db, ...ctx, origin },
    );
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "tooLarge" });
  }));
test("HTTP upload returns private data and byte-identical sandboxed downloads", async () =>
  fixture(async (ctx) => {
    const origin = "https://atlas.example",
      form = new FormData();
    for (const [key, value] of Object.entries({
      ...input,
      difficulty: String(input.difficulty),
      tags: JSON.stringify(input.tags),
      requestId: randomUUID(),
    }))
      form.set(key, value);
    form.set(
      "file",
      new Blob([gpx], { type: "application/gpx+xml" }),
      "private-original.gpx",
    );
    const dependencies = { db, ...ctx, origin };
    const response = await handleTrackRequest(
      new Request(`${origin}/api/tracks`, {
        method: "POST",
        headers: { origin },
        body: form,
      }),
      dependencies,
    );
    assert.equal(response.status, 201);
    const { id } = await response.json();
    const downloaded = await handleTrackRequest(
      new Request(`${origin}/api/tracks/${id}/download`),
      dependencies,
      id,
    );
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), gpx);
    assert.equal(downloaded.headers.get("cache-control"), "private, no-store");
    assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      downloaded.headers.get("content-type"),
      "application/octet-stream",
    );
    assert.match(
      downloaded.headers.get("content-disposition") ?? "",
      /^attachment;/,
    );
    assert.match(
      downloaded.headers.get("content-security-policy") ?? "",
      /sandbox/,
    );
    const data = await handleTrackRequest(
      new Request(`${origin}/api/tracks/${id}/data`),
      dependencies,
      id,
      "data",
    );
    assert.equal(data.status, 200);
    const result = await data.json();
    assert.deepEqual(result.geometry, {
      type: "LineString",
      coordinates: [
        [0, 0],
        [0.01, 0],
      ],
    });
    assert.equal(result.samples.length, 2);
    for (const resource of ["data", "download"] as const) {
      const denied = await handleTrackRequest(
        new Request(`${origin}/api/tracks/${id}/${resource}`),
        { ...dependencies, token: undefined },
        id,
        resource,
      );
      assert.equal(denied.status, 404);
      assert.deepEqual(await denied.json(), { error: "notFound" });
    }
  }));
test("HTTP trims maximal Unicode text before enforcing field limits", async () =>
  fixture(async (ctx) => {
    const origin = "http://localhost:3000";
    const form = new FormData();
    for (const [key, value] of Object.entries({
      name: ` ${"🥾".repeat(200)} `,
      description: ` ${"🌲".repeat(5000)} `,
      activity: "hiking",
      difficulty: "3",
      tags: JSON.stringify(["forest"]),
      requestId: randomUUID(),
    }))
      form.set(key, value);
    form.set(
      "file",
      new File([new Uint8Array(gpx)], "track.gpx", {
        type: "application/gpx+xml",
      }),
    );
    const response = await handleTrackRequest(
      new Request(`${origin}/api/tracks`, {
        method: "POST",
        headers: { origin },
        body: form,
      }),
      { db, ...ctx, origin },
    );
    assert.equal(response.status, 201, await response.text());
  }));

test("structured geometry preserves original coordinate precision", async () =>
  fixture(async (ctx) => {
    const bytes = Buffer.from(
      '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg><trkpt lat="1.1234567891234567" lon="0.12345678912345678"/><trkpt lat="1.1244567891234567" lon="0.12445678912345678"/></trkseg></trk></gpx>',
    );
    const { id } = await createTrack({
      db,
      ...ctx,
      read: async () => ({ requestId: randomUUID(), input, bytes }),
    });
    const data = await getTrackData({ db, token: ctx.token, id });
    assert.deepEqual(data?.geometry.coordinates, [
      [0.12345678912345678, 1.1234567891234567],
      [0.12445678912345678, 1.1244567891234567],
    ]);
  }));

test(
  "100,000-point upload publishes full geometry and analytics within processing bounds",
  { timeout: 30_000 },
  async () =>
    fixture(async (ctx) => {
      const points = Array.from(
        { length: 100_000 },
        (_, i) =>
          `<trkpt lat="48" lon="${16 + i / 1_000_000}"><ele>${i % 100}</ele><time>${new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString()}</time></trkpt>`,
      ).join("");
      const bytes = Buffer.from(
        `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="performance"><trk><trkseg>${points}</trkseg></trk></gpx>`,
      );
      assert.ok(bytes.length <= 10 * 1024 * 1024);
      const started = performance.now();
      let peakRss = process.memoryUsage().rss;
      const sample = setInterval(
        () => (peakRss = Math.max(peakRss, process.memoryUsage().rss)),
        10,
      );
      try {
        const { id } = await createTrack({
          db,
          ...ctx,
          read: async () => ({ requestId: randomUUID(), input, bytes }),
        });
        const publishedMilliseconds = performance.now() - started;
        const data = await getTrackData({ db, token: ctx.token, id });
        assert.equal(data?.geometry.coordinates.length, 100_000);
        assert.equal(data?.samples.length, 100_000);
        assert.deepEqual(
          (await downloadTrack({ db, ...ctx, id })).bytes,
          bytes,
        );
        console.info(
          "Track publication benchmark",
          JSON.stringify({
            points: 100_000,
            inputBytes: bytes.length,
            publishedMilliseconds: Math.round(publishedMilliseconds),
            dataBytes: Buffer.byteLength(JSON.stringify(data)),
            sampledPeakRssMiB: Math.round(peakRss / 1024 / 1024),
          }),
        );
      } finally {
        clearInterval(sample);
      }
    }),
);

test("a confirmed uploader creates a complete private Track and downloads the unchanged original", async () =>
  fixture(async (ctx) => {
    const requestId = randomUUID();
    const { id } = await createTrack({
      db,
      ...ctx,
      read: async () => ({ requestId, input, bytes: gpx }),
    });
    const track = await getTrack({ db, token: ctx.token, id });
    assert.equal(track?.name, "Test track");
    assert.deepEqual(track?.tags, ["forest"]);
    assert.equal(track?.visibility, "private");
    assert.equal(track?.pointCount, 2);
    assert.ok(track && Math.abs(track.distanceMeters - 1113.1949) < 0.01);
    assert.deepEqual((await downloadTrack({ db, ...ctx, id })).bytes, gpx);
    assert.equal(await getTrack({ db, token: undefined, id }), null);
    const again = await createTrack({
      db,
      ...ctx,
      read: async () => ({ requestId, input, bytes: gpx }),
    });
    assert.equal(again.id, id);
  }));

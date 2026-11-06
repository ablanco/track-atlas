import { createAcceptedSession as createSession } from "../helpers/accepted-session";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  loseReadyFileCommit,
  rejectSecondTrackInsert,
} from "./file-commit-fault";
import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import {
  users,
  storedFiles,
  tracks,
  trackUploadAttempts,
  deletedTrackUploads,
} from "../../db/schema";
import { eraseAccount } from "../../auth/account-erasure";
import { getAdminRecord, listAdminRecords } from "../../admin/queries";
import { revokeSession } from "../../auth/session-store";
import { signupFixture } from "./auth-helpers";
import { getStorageConfig } from "../../storage/config";
import { createObjectStore, type ObjectStore } from "../../storage/objects";
import {
  createTrack,
  getTrackUploadResult,
  updateTrack,
  deleteTrack,
  getTrack,
  getTrackData,
  getTrackSamples,
  downloadTrack,
} from "../../tracks/service";
import { parseGpx, processGpxDocument } from "../../tracks/gpx";
import { TrackError } from "../../tracks/validation";
import sharp from "sharp";
import {
  deleteFile,
  cleanupFiles,
  uploadFile,
  downloadFile,
} from "../../storage/files";
import { handleTrackRequest } from "../../tracks/http";
import { handleExploreRequest } from "../../tracks/explore-http";
import { handleTrackMutation } from "../../tracks/mutations-http";
import { getExploreResults, getExploreGeometry } from "../../tracks/explore";
import { parseExploreFilters } from "../../tracks/explore-query";

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
      await tx.execute(
        sql`UPDATE track_photos SET track_id=NULL WHERE track_id IN (SELECT id FROM tracks WHERE owner_id=${user.id})`,
      );
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
test("Tracks can be published and retried without tags while tag ordinals remain contiguous", async () =>
  fixture(async (ctx) => {
    const requestId = randomUUID();
    const read = async () => ({
      requestId,
      input: { ...input, tags: [] },
      bytes: gpx,
    });
    const result = await createTrack({ db, ...ctx, read });
    assert.deepEqual(
      (await getTrack({ db, token: ctx.token, id: result.id }))?.tags,
      [],
    );
    assert.deepEqual(await createTrack({ db, ...ctx, read }), result);
    assert.deepEqual(
      (await downloadTrack({ db, ...ctx, id: result.id })).bytes,
      gpx,
    );
    await assert.rejects(
      db.execute(
        sql`INSERT INTO track_tags(track_id,ordinal,label,normalized_key) VALUES(${result.id},1,\u0027forest\u0027,\u0027forest\u0027)`,
      ),
    );
    await db.execute(
      sql`INSERT INTO track_tags(track_id,ordinal,label,normalized_key) VALUES(${result.id},0,\u0027forest\u0027,\u0027forest\u0027)`,
    );
    await assert.rejects(
      db.execute(
        sql`INSERT INTO track_tags(track_id,ordinal,label,normalized_key) VALUES(${result.id},2,\u0027ridge\u0027,\u0027ridge\u0027)`,
      ),
    );
    await db.execute(sql`DELETE FROM track_tags WHERE track_id=${result.id}`);
    assert.deepEqual(
      (await getTrack({ db, token: ctx.token, id: result.id }))?.tags,
      [],
    );
  }));

test("pre-publication private retry fingerprints recover the same Track without allowing visibility changes", async () =>
  fixture(async (ctx) => {
    const requestId = randomUUID();
    const result = await upload(ctx, requestId);
    // Persist the canonical payload used before visibility was introduced.
    const sha256 = createHash("sha256").update(gpx).digest("hex");
    const legacyFingerprint = createHash("sha256")
      .update(JSON.stringify({ input, sha256 }))
      .digest("hex");
    await db
      .update(trackUploadAttempts)
      .set({ fingerprint: legacyFingerprint })
      .where(eq(trackUploadAttempts.trackId, result.id));
    assert.deepEqual(await upload(ctx, requestId), result);
    assert.deepEqual(
      await upload(ctx, requestId, {
        read: async () => ({
          requestId,
          input: { ...input, visibility: "private" },
          bytes: gpx,
        }),
      }),
      result,
    );
    await assert.rejects(
      upload(ctx, requestId, {
        read: async () => ({
          requestId,
          input: { ...input, visibility: "public" },
          bytes: gpx,
        }),
      }),
      code("conflict"),
    );
  }));

test("public creation permits guest viewing but requires a session for original downloads", async () =>
  fixture(async (ctx) => {
    const requestId = randomUUID();
    const read = async () => ({
      requestId,
      input: { ...input, visibility: "public" },
      bytes: gpx,
    });
    const { id } = await createTrack({ db, ...ctx, read });
    assert.equal(
      (await getTrack({ db, token: undefined, id }))?.visibility,
      "public",
    );
    await fixture(async (other) => {
      const revoked = (await createSession(db, other.userId)).token;
      await revokeSession(db, revoked);
      for (const token of [
        undefined,
        "invalid",
        ctx.token,
        other.token,
        revoked,
      ]) {
        assert.equal((await getTrack({ db, token, id }))?.name, input.name);
        assert.equal(
          (await getTrackData({ db, token, id }))?.geometry.coordinates[0]
            .length,
          2,
        );
        assert.equal(
          (await getTrackSamples({ db, token, id }))?.samples.length,
          2,
        );
        for (const resource of ["data", "download"] as const) {
          const response = await handleTrackRequest(
            new Request(`https://atlas.example/api/tracks/${id}/${resource}`),
            { db, store: ctx.store, token, origin: "https://atlas.example" },
            id,
            resource,
          );
          const authenticated = token === ctx.token || token === other.token;
          assert.equal(
            response.status,
            resource === "download" && !authenticated ? 401 : 200,
          );
          assert.equal(
            response.headers.get("cache-control"),
            "private, no-store",
          );
          if (resource === "download") {
            if (authenticated)
              assert.deepEqual(Buffer.from(await response.arrayBuffer()), gpx);
            else
              assert.deepEqual(await response.json(), {
                error: "unauthorized",
              });
          }
        }
      }
    });
    assert.equal((await createTrack({ db, ...ctx, read })).id, id);
    await assert.rejects(
      createTrack({
        db,
        ...ctx,
        read: async () => ({ requestId, input, bytes: gpx }),
      }),
      code("conflict"),
    );
    await db
      .update(users)
      .set({ active: false })
      .where(eq(users.id, ctx.userId));
    for (const token of [undefined, ctx.token]) {
      assert.equal(await getTrack({ db, token, id }), null);
      assert.equal(await getTrackData({ db, token, id }), null);
      assert.equal(await getTrackSamples({ db, token, id }), null);
      await assert.rejects(
        downloadTrack({ db, store: ctx.store, token, id }),
        code("unauthorized"),
      );
    }
  }));

test("every Track resource applies the private/public identity matrix and indistinguishable missing, unpublished and inactive denial", async () =>
  fixture(async (ctx) =>
    fixture(async (other) => {
      // Downloading requires login, not the email confirmation needed to upload.
      await db
        .update(users)
        .set({ emailConfirmed: false })
        .where(eq(users.id, other.userId));
      const original = await sharp({
        create: { width: 32, height: 32, channels: 3, background: "blue" },
      })
        .png()
        .toBuffer();
      await uploadFile({
        db,
        ...ctx,
        purpose: "avatar",
        contentType: "image/png",
        read: async () => original,
      });
      const privateTrack = await upload(ctx);
      const publicTrack = await upload(ctx, randomUUID(), {
        read: async () => ({
          requestId: randomUUID(),
          input: { ...input, visibility: "public" },
          bytes: gpx,
        }),
      });
      const revoked = (await createSession(db, ctx.userId)).token;
      await revokeSession(db, revoked);
      const expired = (await createSession(db, ctx.userId)).token;
      const expiredHash = createHash("sha256").update(expired).digest("hex");
      await db.execute(
        sql`UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=${expiredHash}`,
      );
      // A reserved original is not a published Track and has no readable Track URL.
      const unpublished = randomUUID();
      await db.insert(storedFiles).values({
        id: unpublished,
        ownerId: ctx.userId,
        purpose: "gpx",
        objectKey: unpublished,
        storageLocation: ctx.store.location,
        byteSize: 10 * 1024 * 1024,
      });
      const identities = [
        { name: "guest", token: undefined },
        { name: "malformed", token: "invalid" },
        {
          name: "unknown",
          token: createHash("sha256").update(randomUUID()).digest("base64url"),
        },
        { name: "owner", token: ctx.token },
        { name: "foreign", token: other.token },
        { name: "expired owner", token: expired },
        { name: "revoked owner", token: revoked },
      ];
      for (const active of [true, false]) {
        await db.update(users).set({ active }).where(eq(users.id, ctx.userId));
        for (const identity of identities) {
          for (const candidate of [
            {
              id: privateTrack.id,
              allowed: active && identity.name === "owner",
            },
            { id: publicTrack.id, allowed: active },
            { id: randomUUID(), allowed: false },
            { id: "invalid-id", allowed: false },
            { id: unpublished, allowed: false },
          ]) {
            const deps = {
              db,
              store: ctx.store,
              token: identity.token,
              id: candidate.id,
            };
            const label = `${active ? "active" : "inactive"} ${identity.name} ${candidate.id}`;
            assert.equal(
              (await getTrack(deps)) !== null,
              candidate.allowed,
              `details: ${label}`,
            );
            assert.equal(
              (await getTrackSamples(deps)) !== null,
              candidate.allowed,
              `charts: ${label}`,
            );
            assert.equal(
              (await getTrackData(deps)) !== null,
              candidate.allowed,
              `geometry: ${label}`,
            );
            for (const resource of ["data", "download", "avatar"] as const) {
              const authenticated =
                identity.name === "foreign" ||
                (active && identity.name === "owner");
              const unauthorized = resource === "download" && !authenticated;
              const response = await handleTrackRequest(
                new Request(
                  `https://atlas.example/api/tracks/${candidate.id}/${resource}`,
                ),
                { ...deps, origin: "https://atlas.example" },
                candidate.id,
                resource,
              );
              assert.equal(
                response.status,
                unauthorized ? 401 : candidate.allowed ? 200 : 404,
                `${resource}: ${label}`,
              );
              assert.equal(
                response.headers.get("cache-control"),
                "private, no-store",
              );
              assert.equal(
                response.headers.get("x-content-type-options"),
                "nosniff",
              );
              if (unauthorized || !candidate.allowed)
                assert.deepEqual(await response.json(), {
                  error: unauthorized ? "unauthorized" : "notFound",
                });
            }
          }
        }
      }
    }),
  ));

test("track-scoped avatars serve only the current derived image with access, integrity and replacement checks", async () =>
  fixture(async (ctx) => {
    const { id } = await createTrack({
      db,
      ...ctx,
      read: async () => ({
        requestId: randomUUID(),
        input: { ...input, visibility: "public" },
        bytes: gpx,
      }),
    });
    const request = () =>
      new Request(`https://atlas.example/api/tracks/${id}/avatar`);
    const deps = {
      db,
      ...ctx,
      token: undefined,
      origin: "https://atlas.example",
    };
    assert.equal(
      (await handleTrackRequest(request(), deps, id, "avatar")).status,
      404,
    );
    const original = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const avatar = () =>
      uploadFile({
        db,
        ...ctx,
        purpose: "avatar",
        contentType: "image/png",
        read: async () => original,
      });
    const first = await avatar();
    const response = await handleTrackRequest(request(), deps, id, "avatar");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.notDeepEqual(bytes, original);
    assert.equal((await sharp(bytes).metadata()).width, 128);
    await assert.rejects(
      downloadFile({ db, ...ctx, token: undefined, id: first.id }),
    );
    const second = await avatar();
    await ctx.store.remove(`avatars/128/${first.id}`);
    assert.equal(
      (await handleTrackRequest(request(), deps, id, "avatar")).status,
      200,
    );
    const corrupt = { ...ctx.store, get: async () => original };
    assert.equal(
      (
        await handleTrackRequest(
          request(),
          { ...deps, store: corrupt },
          id,
          "avatar",
        )
      ).status,
      503,
    );
    await deleteFile({ db, ...ctx, id: second.id });
    assert.equal(
      (await handleTrackRequest(request(), deps, id, "avatar")).status,
      404,
    );
    await avatar();
    await db
      .update(tracks)
      .set({ visibility: "private" })
      .where(eq(tracks.id, id));
    assert.equal(
      (await handleTrackRequest(request(), deps, id, "avatar")).status,
      404,
    );
    assert.equal(
      (
        await handleTrackRequest(
          request(),
          { ...deps, token: ctx.token },
          id,
          "avatar",
        )
      ).status,
      200,
    );
    await db
      .update(users)
      .set({ active: false })
      .where(eq(users.id, ctx.userId));
    assert.equal(
      (
        await handleTrackRequest(
          request(),
          { ...deps, token: ctx.token },
          id,
          "avatar",
        )
      ).status,
      404,
    );
  }));

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
            code(token ? "notFound" : "unauthorized"),
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
    await assert.rejects(
      downloadTrack({ db, ...ctx, id }),
      code("unauthorized"),
    );
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
          { length: limit === "pending" ? 2 : limit === "count" ? 100 : 52 },
          () => {
            const id = randomUUID();
            return {
              id,
              objectKey: id,
              ownerId: ctx.userId,
              purpose:
                limit === "bytes" ? ("photo" as const) : ("gpx" as const),
              status:
                limit === "pending" ? ("pending" as const) : ("ready" as const),
              storageLocation: ctx.store.location,
              byteSize:
                limit === "count"
                  ? 1
                  : (limit === "bytes" ? 20 : 10) * 1024 * 1024,
              contentType:
                limit === "pending"
                  ? null
                  : limit === "bytes"
                    ? "image/jpeg"
                    : "application/gpx+xml",
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
    const restore = loseReadyFileCommit(pool);
    try {
      await assert.rejects(upload(ctx, requestId));
    } finally {
      restore();
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
    assert.deepEqual(await getTrackSamples({ db, token: ctx.token, id }), {
      samples: data?.samples,
      segmentStarts: [0],
    });
    assert.deepEqual(data?.geometry, {
      type: "MultiLineString",
      coordinates: [
        [
          [-3, 40],
          [-3, 40],
          [-3.01, 40.01],
          [-3.02, 40.02],
        ],
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
      type: "MultiLineString",
      coordinates: [
        [
          [0, 0],
          [0.01, 0],
        ],
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
      assert.equal(denied.status, resource === "download" ? 401 : 404);
      assert.deepEqual(await denied.json(), {
        error: resource === "download" ? "unauthorized" : "notFound",
      });
    }
  }));
test("map HTTP geometry preserves loops and dateline points with centralized denial", async () =>
  fixture(async (ctx) => {
    const bytes = Buffer.from(
      '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg><trkpt lat="80" lon="179.9"/><trkpt lat="80" lon="179.9"/><trkpt lat="80.01" lon="-179.9"/><trkpt lat="80" lon="179.9"/></trkseg></trk></gpx>',
    );
    const { id } = await upload(ctx, randomUUID(), {
      read: async () => ({ requestId: randomUUID(), input, bytes }),
    });
    const origin = "https://atlas.example";
    const read = (candidate: string, token = ctx.token) =>
      handleTrackRequest(
        new Request(`${origin}/api/tracks/${candidate}/data`),
        { db, ...ctx, token, origin },
        candidate,
        "data",
      );
    const response = await read(id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual((await response.json()).geometry, {
      type: "MultiLineString",
      coordinates: [
        [
          [179.9, 80],
          [179.9, 80],
          [-179.9, 80.01],
          [179.9, 80],
        ],
      ],
    });
    const missing = await read(randomUUID());
    const expected = await missing.json();
    await fixture(async (other) => {
      const foreign = await read(id, other.token);
      assert.equal(foreign.status, missing.status);
      assert.deepEqual(await foreign.json(), expected);
    });
    await db.execute(
      sql`UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=${ctx.userId}`,
    );
    const expired = await read(id);
    assert.equal(expired.status, missing.status);
    assert.deepEqual(await expired.json(), expected);
    const fresh = await createSession(db, ctx.userId);
    await revokeSession(db, fresh.token);
    const revoked = await read(id, fresh.token);
    assert.equal(revoked.status, missing.status);
    assert.deepEqual(await revoked.json(), expected);
    const current = await createSession(db, ctx.userId);
    await db
      .update(users)
      .set({ active: false })
      .where(eq(users.id, ctx.userId));
    const inactive = await read(id, current.token);
    assert.equal(inactive.status, missing.status);
    assert.deepEqual(await inactive.json(), expected);
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
    assert.deepEqual(data?.geometry.coordinates[0], [
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
        assert.equal(data?.geometry.coordinates[0].length, 100_000);
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

test("owners replace metadata atomically without reconfirmation and later saves win", async () =>
  fixture(async (ctx) => {
    const { id } = await upload(ctx);
    const before = await getTrack({ db, ...ctx, id });
    const geometry = await getTrackData({ db, ...ctx, id });
    await db
      .update(users)
      .set({ emailConfirmed: false })
      .where(eq(users.id, ctx.userId));
    const first = {
      ...input,
      name: " New title ",
      tags: ["Ridge", "ＲＩＤＧＥ"],
      visibility: "public" as const,
    };
    await updateTrack({ db, ...ctx, id, input: first });
    const publicTrack = await getTrack({ db, token: undefined, id });
    assert.equal(publicTrack?.name, "New title");
    assert.deepEqual(publicTrack?.tags, ["Ridge"]);
    const found = await getExploreResults({
      db,
      token: undefined,
      ownerId: ctx.userId,
      filters: parseExploreFilters(
        new URLSearchParams("q=ridge&activity=hiking&difficulty=3"),
      ),
    });
    assert.deepEqual(
      found?.tracks.map((track) => track.id),
      [id],
    );
    assert.equal(
      (
        await getExploreResults({
          db,
          token: undefined,
          ownerId: ctx.userId,
          filters: parseExploreFilters(new URLSearchParams("q=forest")),
        })
      )?.total,
      0,
    );
    assert.equal(publicTrack?.canEdit, false);
    assert.equal((await getTrack({ db, ...ctx, id }))?.canEdit, true);
    await assert.rejects(
      updateTrack({
        db,
        ...ctx,
        id,
        input: { ...first, name: "", tags: ["changed"] },
      }),
      code("invalidMetadata"),
    );
    assert.deepEqual((await getTrack({ db, ...ctx, id }))?.tags, ["Ridge"]);
    await updateTrack({
      db,
      ...ctx,
      id,
      input: { ...input, name: "Second save", tags: [], visibility: "private" },
    });
    const after = await getTrack({ db, ...ctx, id });
    assert.equal(after?.name, "Second save");
    assert.deepEqual(after?.tags, []);
    assert.equal(
      after?.createdAt.toISOString(),
      before?.createdAt.toISOString(),
    );
    assert.deepEqual(await getTrackData({ db, ...ctx, id }), geometry);
    assert.equal(await getTrack({ db, token: undefined, id }), null);
    assert.equal(await getTrackData({ db, token: undefined, id }), null);
    assert.equal(await getExploreGeometry({ db, token: undefined, id }), null);
    assert.equal(
      (
        await getExploreResults({
          db,
          token: undefined,
          ownerId: ctx.userId,
          filters: parseExploreFilters(new URLSearchParams()),
        })
      )?.total,
      0,
    );
    assert.deepEqual((await downloadTrack({ db, ...ctx, id })).bytes, gpx);
  }));

test("track mutations deny guests, foreign owners, revoked sessions and inactive accounts", async () =>
  fixture(async (ctx) => {
    const { id } = await upload(ctx, randomUUID(), {
      read: async () => ({
        requestId: randomUUID(),
        input: { ...input, visibility: "public" },
        bytes: gpx,
      }),
    });
    for (const mutate of [
      (token: string | undefined) =>
        updateTrack({
          db,
          token,
          id,
          input: { ...input, visibility: "public" },
        }),
      (token: string | undefined) => deleteTrack({ db, token, id }),
    ]) {
      await assert.rejects(mutate(undefined), code("unauthorized"));
      await fixture(async (other) => {
        await assert.rejects(mutate(other.token), code("notFound"));
      });
      const revoked = await createSession(db, ctx.userId);
      await revokeSession(db, revoked.token);
      await assert.rejects(mutate(revoked.token), code("unauthorized"));
      const expired = await createSession(db, ctx.userId);
      await db.execute(
        sql`UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=${createHash("sha256").update(expired.token).digest("hex")}`,
      );
      await assert.rejects(mutate(expired.token), code("unauthorized"));
    }
    await db
      .update(users)
      .set({ active: false })
      .where(eq(users.id, ctx.userId));
    await assert.rejects(deleteTrack({ db, ...ctx, id }), code("unauthorized"));
    await assert.rejects(
      updateTrack({
        db,
        ...ctx,
        id,
        input: { ...input, visibility: "public" },
      }),
      code("unauthorized"),
    );
  }));

test("deletion withdraws all data, survives cleanup failure, and prevents old upload retries after cleanup", async () =>
  fixture(async (ctx) => {
    const requestId = randomUUID();
    const { id } = await upload(ctx, requestId);
    const [track] = await db.select().from(tracks).where(eq(tracks.id, id));
    await db
      .update(users)
      .set({ emailConfirmed: false })
      .where(eq(users.id, ctx.userId));
    await deleteTrack({ db, ...ctx, id });
    await deleteTrack({ db, ...ctx, id }); // Lost acknowledgements can safely retry.
    for (const read of [getTrack, getTrackData, getTrackSamples])
      assert.equal(await read({ db, ...ctx, id }), null);
    await assert.rejects(downloadTrack({ db, ...ctx, id }), code("notFound"));
    assert.equal(await getExploreGeometry({ db, ...ctx, id }), null);
    assert.equal(
      (
        await getExploreResults({
          db,
          ...ctx,
          ownerId: ctx.userId,
          filters: parseExploreFilters(new URLSearchParams()),
        })
      )?.total,
      0,
    );
    const result = await db.execute(
      sql`SELECT (SELECT count(*) FROM track_data WHERE track_id=${id}) + (SELECT count(*) FROM track_tags WHERE track_id=${id}) + (SELECT count(*) FROM track_directional_representations WHERE track_id=${id}) AS remaining`,
    );
    assert.equal(Number(result.rows[0].remaining), 0);
    assert.equal(
      (
        await db
          .select()
          .from(storedFiles)
          .where(eq(storedFiles.id, track.originalFileId))
      )[0].status,
      "deleting",
    );
    const failed = await cleanupFiles({
      db,
      store: {
        ...ctx.store,
        remove: async () => {
          throw new Error("storage unavailable");
        },
      },
    });
    assert.equal(failed.failed, 1);
    assert.equal(
      (
        await db
          .select()
          .from(storedFiles)
          .where(eq(storedFiles.id, track.originalFileId))
      ).length,
      1,
    );
    await cleanupFiles({ db, store: ctx.store });
    assert.equal(
      (
        await db
          .select()
          .from(storedFiles)
          .where(eq(storedFiles.id, track.originalFileId))
      ).length,
      0,
    );
    await db
      .update(users)
      .set({ emailConfirmed: true })
      .where(eq(users.id, ctx.userId));
    await assert.rejects(upload(ctx, requestId), code("notFound"));
    assert.notEqual((await upload(ctx, randomUUID())).id, id);
    const [receipt] = await db
      .select()
      .from(deletedTrackUploads)
      .where(eq(deletedTrackUploads.trackId, id));
    await db.execute(sql`SELECT pg_sleep(0.005)`);
    const updated = await db
      .update(deletedTrackUploads)
      .set({ trackId: id })
      .where(eq(deletedTrackUploads.trackId, id))
      .returning();
    assert.equal(
      updated[0].createdAt.toISOString(),
      receipt.createdAt.toISOString(),
    );
    assert.ok(updated[0].updatedAt > receipt.updatedAt);
  }));

test("metadata HTTP mutations enforce origin, bounded JSON and allowlisted complete inputs", async () =>
  fixture(async (ctx) => {
    const { id } = await upload(ctx);
    const origin = "https://atlas.example";
    const body = { ...input, visibility: "private" };
    const mutate = (
      payload: unknown,
      headers: Record<string, string> = {},
      token: string | undefined = ctx.token,
      candidate = id,
    ) =>
      handleTrackMutation(
        new Request(`${origin}/api/tracks/${candidate}`, {
          method: "PATCH",
          headers: { origin, "content-type": "application/json", ...headers },
          body: JSON.stringify(payload),
        }),
        { db, token, origin },
        candidate,
      );
    for (const payload of [
      { ...body, ownerId: ctx.userId },
      { ...input },
      { ...body, admin: true },
    ])
      assert.equal((await mutate(payload)).status, 400);
    assert.equal((await mutate({ ...body, difficulty: 6 })).status, 422);
    assert.equal(
      (await mutate(body, { origin: "https://foreign.example" })).status,
      403,
    );
    assert.equal(
      (await mutate(body, { "sec-fetch-site": "cross-site" })).status,
      403,
    );
    assert.equal(
      (await mutate(body, { "content-encoding": "gzip" })).status,
      400,
    );
    assert.equal(
      (await mutate({ ...body, description: "x".repeat(97 * 1024) })).status,
      413,
    );
    assert.equal((await mutate(body, {}, "invalid")).status, 401);
    assert.equal((await mutate(body, {}, ctx.token, randomUUID())).status, 404);
    const saved = await mutate({ ...body, name: " Updated " });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).name, "Updated");
    assert.equal(saved.headers.get("cache-control"), "private, no-store");
    const removed = await handleTrackMutation(
      new Request(`${origin}/api/tracks/${id}`, {
        method: "DELETE",
        headers: { origin },
      }),
      { db, ...ctx, origin },
      id,
    );
    assert.equal(removed.status, 204);
    assert.equal(removed.headers.get("cache-control"), "private, no-store");
  }));

test("multipart upload preserves segment boundaries through service and HTTP reads", async () =>
  fixture(async (ctx) => {
    const bytes = Buffer.from(
      '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests"><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.01"/></trkseg><trkseg><trkpt lat="10" lon="10"/><trkpt lat="10" lon="10.01"/></trkseg></trk></gpx>',
    );
    const { id } = await createTrack({
      db,
      ...ctx,
      read: async () => ({ requestId: randomUUID(), input, bytes }),
    });
    assert.equal((await getTrack({ db, ...ctx, id }))?.segmentCount, 2);
    const data = await getTrackData({ db, ...ctx, id });
    assert.deepEqual(data?.segmentStarts, [0, 2]);
    assert.deepEqual(data?.geometry, {
      type: "MultiLineString",
      coordinates: [
        [
          [0, 0],
          [0.01, 0],
        ],
        [
          [10, 10],
          [10.01, 10],
        ],
      ],
    });
    assert.deepEqual(await getTrackSamples({ db, ...ctx, id }), {
      samples: data?.samples,
      segmentStarts: [0, 2],
    });
    const response = await handleTrackRequest(
      new Request(`https://atlas.example/api/tracks/${id}/data`),
      { db, ...ctx, origin: "https://atlas.example" },
      id,
      "data",
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...data, waypoints: [] });
    assert.deepEqual((await downloadTrack({ db, ...ctx, id })).bytes, bytes);
  }));

test("100-segment publication searches real parts without connectors and preserves access", async (t) =>
  fixture(async (ctx) => {
    const bytes = Buffer.from(
      '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk>' +
        Array.from(
          { length: 100 },
          (_, i) =>
            `<trkseg><trkpt lat="${i * 0.1}" lon="0"/><trkpt lat="${i * 0.1}" lon="0.06"/></trkseg>`,
        ).join("") +
        "</trk></gpx>",
    );
    const { id } = await createTrack({
      db,
      ...ctx,
      read: async () => ({
        requestId: randomUUID(),
        input: { ...input, visibility: "public" },
        bytes,
      }),
    });
    assert.equal((await getTrack({ db, ...ctx, id }))?.segmentCount, 100);
    const search = async (
      query: string,
      token: string | undefined = undefined,
    ) =>
      getExploreResults({
        db,
        token,
        ownerId: ctx.userId,
        filters: parseExploreFilters(new URLSearchParams(query)),
      });
    const started = performance.now();
    assert.equal(
      (
        await search(
          "viewport=-0.01,9.89,0.01,9.91&drawMode=arrow&drawStart=0,0&drawEnd=0.06,0&corridorKm=0.1",
        )
      )?.tracks[0]?.id,
      id,
    );
    // Both endpoints of this hypothetical diagonal connector lie outside the corridor.
    assert.equal(
      (
        await search(
          "drawMode=line&drawStart=0.036,0.04&drawEnd=0.024,0.06&corridorKm=0.1",
        )
      )?.total,
      0,
    );
    assert.equal((await search("viewport=0.029,0.049,0.031,0.051"))?.total, 0);
    // Approximate viewport matching still uses sampled vertices, not the full part.
    assert.equal((await search("viewport=0.004,-0.001,0.006,0.001"))?.total, 0);
    assert.ok(
      performance.now() - started < 5000,
      "100-segment searches remain interactive",
    );
    t.diagnostic(
      `100-segment spatial service queries: ${Math.round(performance.now() - started)}ms`,
    );
    for (const criteria of [
      "viewport=-0.01,9.89,0.01,9.91",
      "drawMode=arrow&drawStart=0,0&drawEnd=0.06,0&corridorKm=0.1",
    ]) {
      let statement: import("drizzle-orm").SQL | undefined;
      const observed = new Proxy(db, {
        get(target, key, receiver) {
          if (key === "execute")
            return (query: import("drizzle-orm").SQL) => {
              statement = query;
              return target.execute(query);
            };
          return Reflect.get(target, key, receiver);
        },
      });
      await getExploreResults({
        db: observed,
        token: undefined,
        ownerId: ctx.userId,
        filters: parseExploreFilters(new URLSearchParams(criteria)),
      });
      const explained = await db.execute(
        sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement!}`,
      );
      const plan = (
        explained.rows[0]["QUERY PLAN"] as Record<string, unknown>[]
      )[0];
      const indexes: string[] = [];
      const visit = (node: Record<string, unknown>) => {
        if (node["Index Name"]) indexes.push(String(node["Index Name"]));
        for (const child of (node.Plans ?? []) as Record<string, unknown>[])
          visit(child);
      };
      visit(plan.Plan as Record<string, unknown>);
      t.diagnostic(
        JSON.stringify({
          segments: 100,
          criteria,
          executionMs: plan["Execution Time"],
          indexes,
        }),
      );
    }
    await updateTrack({
      db,
      ...ctx,
      id,
      input: { ...input, visibility: "private" },
    });
    assert.equal(await getTrackData({ db, token: undefined, id }), null);
    assert.equal((await search("", undefined))?.total, 0);
    assert.equal((await search("", ctx.token))?.total, 1);
    assert.equal(await getExploreGeometry({ db, token: undefined, id }), null);
    assert.equal(
      (await getExploreGeometry({ db, ...ctx, id }))?.geometry.coordinates
        .length,
      100,
    );
  }));

test("multipart publication rejects corrupt offsets, missing parts and incomplete representation groups", async () =>
  fixture(async (ctx) => {
    const bytes = Buffer.from(
      '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="1"/></trkseg><trkseg><trkpt lat="10" lon="0"/><trkpt lat="10" lon="1"/></trkseg></trk></gpx>',
    );
    const { id } = await createTrack({
      db,
      ...ctx,
      read: async () => ({ requestId: randomUUID(), input, bytes }),
    });
    for (const starts of [
      "[0]",
      "[0,1]",
      "[0,3]",
      "[0,0]",
      '[0,"2"]',
      "{}",
      "[0,2,4]",
    ])
      await assert.rejects(
        db.execute(
          sql`UPDATE track_data SET segment_starts=${starts}::jsonb WHERE track_id=${id}`,
        ),
      );
    await assert.rejects(
      db.execute(
        sql`UPDATE track_data SET geometry=ST_GeomFromText('MULTILINESTRING((0 0,1 0),EMPTY)',4326) WHERE track_id=${id}`,
      ),
    );
    await assert.rejects(
      db.execute(
        sql`DELETE FROM track_directional_representations WHERE track_id=${id} AND segment_index=1 AND intermediate_count=5`,
      ),
    );
    await assert.rejects(
      db.execute(
        sql`UPDATE track_directional_representations SET segment_index=2 WHERE track_id=${id} AND segment_index=1`,
      ),
    );
    await assert.rejects(
      db.execute(sql`UPDATE tracks SET segment_count=1 WHERE id=${id}`),
    );
    assert.deepEqual(
      (await getTrackData({ db, ...ctx, id }))?.segmentStarts,
      [0, 2],
    );
  }));

test("one document creates ordered independent Tracks and isolated downloads, with stable retry IDs", async () =>
  fixture(async (ctx) => {
    const bytes = Buffer.from(
      gpx
        .toString()
        .replace(
          "</gpx>",
          '<trk><name>Second</name><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1" lon="1.01"/></trkseg></trk></gpx>',
        ),
    );
    const read = async () => ({
      requestId: randomRequest,
      input: { ...input, visibility: "public" },
      bytes,
    });
    const randomRequest = randomUUID();
    const result = await createTrack({ db, ...ctx, read });
    const ids = (result as { id: string; ids: string[] }).ids;
    assert.equal(ids?.length, 2);
    assert.equal(result.id, ids[0]);
    assert.notEqual(ids[0], ids[1]);
    for (const [index, id] of ids.entries()) {
      const track = await getTrack({ db, token: ctx.token, id });
      assert.equal(track?.name, `Test track ${index + 1}`);
      assert.equal(track?.description, input.description);
      assert.equal(track?.activity, input.activity);
      assert.equal(track?.difficulty, input.difficulty);
      assert.equal(track?.visibility, "public");
      assert.deepEqual(track?.tags, input.tags);
      const download = await downloadTrack({ db, ...ctx, id });
      const xml = download.bytes.toString();
      assert.equal((xml.match(/<trk>/g) ?? []).length, 1);
      assert.equal(xml.includes("Second"), index === 1);
      assert.equal(xml.includes('lat="0"'), index === 0);
    }
    assert.deepEqual(await createTrack({ db, ...ctx, read }), result);
  }));

const multiGpx = Buffer.from(
  gpx
    .toString()
    .replace(
      "</gpx>",
      '<trk><name>Second</name><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1" lon="1.01"/></trkseg></trk></gpx>',
    ),
);

test("deleting either sibling keeps the other editable/downloadable and tombstones the entire attempt after cleanup", async () => {
  for (const deletedIndex of [0, 1])
    await fixture(async (ctx) => {
      const requestId = randomUUID();
      const read = async () => ({ requestId, input, bytes: multiGpx });
      const { ids } = await createTrack({ db, ...ctx, read });
      await deleteTrack({ db, ...ctx, id: ids[deletedIndex] });
      await deleteTrack({ db, ...ctx, id: ids[deletedIndex] });
      await cleanupFiles({ db, store: ctx.store });
      await assert.rejects(createTrack({ db, ...ctx, read }), code("notFound"));
      const survivor = ids[1 - deletedIndex];
      await updateTrack({
        db,
        ...ctx,
        id: survivor,
        input: { ...input, name: "Independent", visibility: "public" },
      });
      assert.equal(
        (await getTrack({ db, id: survivor, token: undefined }))?.name,
        "Independent",
      );
      assert.equal(
        (await downloadTrack({ db, ...ctx, id: survivor })).bytes
          .toString()
          .includes("Second"),
        deletedIndex === 0,
      );
      await deleteTrack({ db, ...ctx, id: survivor });
      await cleanupFiles({ db, store: ctx.store });
      await assert.rejects(createTrack({ db, ...ctx, read }), code("notFound"));
      const deliberate = await createTrack({
        db,
        ...ctx,
        read: async () => ({ ...(await read()), requestId: randomUUID() }),
      });
      assert.equal(deliberate.ids.length, 2);
      assert.ok(deliberate.ids.every((id) => !ids.includes(id)));
    });
});

test("a completed upload receipt cannot silently lose a later output outside the deletion lifecycle", async () =>
  fixture(async (ctx) => {
    const read = async () => ({
      requestId: randomRequest,
      input,
      bytes: multiGpx,
    });
    const randomRequest = randomUUID();
    const result = await createTrack({ db, ...ctx, read });
    await assert.rejects(db.delete(tracks).where(eq(tracks.id, result.ids[1])));
    assert.deepEqual(await createTrack({ db, ...ctx, read }), result);
    assert.ok(await getTrack({ db, ...ctx, id: result.ids[1] }));
  }));

test("multi-track storage failure publishes nothing, removes every temporary output and preserves staged photos for retry", async () =>
  fixture(async (ctx) => {
    const photo = await uploadFile({
      db,
      ...ctx,
      purpose: "photo",
      contentType: "image/png",
      read: () =>
        sharp({
          create: { width: 4, height: 4, channels: 3, background: "red" },
        })
          .png()
          .toBuffer(),
    });
    const secondPhoto = await uploadFile({
      db,
      ...ctx,
      purpose: "photo",
      contentType: "image/png",
      read: () =>
        sharp({
          create: { width: 4, height: 4, channels: 3, background: "green" },
        })
          .png()
          .toBuffer(),
    });
    const read = async () => ({
      requestId: attempt,
      input: {
        ...input,
        photos: [
          { id: secondPhoto.id, caption: "Earlier" },
          { id: photo.id, caption: "Later" },
        ],
      },
      bytes: multiGpx,
    });
    const attempt = randomUUID();
    const keys: string[] = [];
    const failing: ObjectStore = {
      ...ctx.store,
      put: async (key, ...args) => {
        keys.push(key);
        await ctx.store.put(key, ...args);
        if (keys.length === 2)
          throw new Error("uncertain second storage write");
      },
    };
    await assert.rejects(createTrack({ db, ...ctx, store: failing, read }));
    assert.equal(
      (
        await getExploreResults({
          db,
          ...ctx,
          ownerId: ctx.userId,
          filters: parseExploreFilters(new URLSearchParams()),
        })
      )?.total,
      0,
    );
    assert.equal(keys.length, 2);
    for (const key of keys)
      assert.equal(await ctx.store.get(key, 10485760), null);
    assert.ok((await downloadFile({ db, ...ctx, id: photo.id })).bytes.length);
    const { ids } = await createTrack({ db, ...ctx, read });
    assert.deepEqual(
      (await getTrack({ db, ...ctx, id: ids[0] }))?.photos.map(
        ({ id, caption }) => ({ id, caption }),
      ),
      [
        { id: secondPhoto.id, caption: "Earlier" },
        { id: photo.id, caption: "Later" },
      ],
    );
    assert.equal(
      (await getTrack({ db, ...ctx, id: ids[1] }))?.photos.length,
      0,
    );
  }));

test("quota counts two concurrent multi-track attempts as two pending uploads, across generic file admission and retries", async () =>
  fixture(async (ctx) => {
    const release = Promise.withResolvers<void>();
    const started = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    const attempts = [randomUUID(), randomUUID()];
    const reads = attempts.map((requestId) => async () => ({
      requestId,
      input,
      bytes: multiGpx,
    }));
    const begin = (index: number) =>
      createTrack({
        db,
        ...ctx,
        read: reads[index],
        store: {
          ...ctx.store,
          put: async (...args) => {
            started[index].resolve();
            await release.promise;
            await ctx.store.put(...args);
          },
        },
      });
    const first = begin(0);
    let second: ReturnType<typeof createTrack> | undefined;
    try {
      await started[0].promise;
      await assert.rejects(
        createTrack({ db, ...ctx, read: reads[0] }),
        code("processing"),
      );
      second = begin(1);
      // If admission fails, surface that rejection instead of hanging on a gate.
      await Promise.race([started[1].promise, second.then(() => {})]);
      await assert.rejects(
        createTrack({
          db,
          ...ctx,
          read: async () => ({
            requestId: randomUUID(),
            input,
            bytes: multiGpx,
          }),
        }),
        code("quotaExceeded"),
      );
      await assert.rejects(
        uploadFile({
          db,
          ...ctx,
          purpose: "gpx",
          contentType: "application/gpx+xml",
          read: async () => gpx,
        }),
        { code: "quotaExceeded" },
      );
    } finally {
      release.resolve();
    }
    const results = await Promise.all([first, second!]);
    for (const [index, result] of results.entries()) {
      assert.equal(result.ids.length, 2);
      assert.deepEqual(
        await createTrack({ db, ...ctx, read: reads[index] }),
        result,
      );
    }
  }));

test("a later database insert failure rolls back all outputs and first-Track photo attachment, then the same attempt retries", async () =>
  fixture(async (ctx) => {
    const photo = await uploadFile({
      db,
      ...ctx,
      purpose: "photo",
      contentType: "image/png",
      read: () =>
        sharp({
          create: { width: 4, height: 4, channels: 3, background: "blue" },
        })
          .png()
          .toBuffer(),
    });
    const requestId = randomUUID();
    const read = async () => ({
      requestId,
      input: { ...input, photos: [{ id: photo.id, caption: "Still staged" }] },
      bytes: multiGpx,
    });
    const keys: string[] = [];
    const store: ObjectStore = {
      ...ctx.store,
      put: async (key, ...args) => {
        keys.push(key);
        await ctx.store.put(key, ...args);
      },
    };
    const restore = rejectSecondTrackInsert(pool);
    try {
      await assert.rejects(createTrack({ db, ...ctx, store, read }));
    } finally {
      restore();
    }
    assert.equal(
      (
        await getExploreResults({
          db,
          ...ctx,
          ownerId: ctx.userId,
          filters: parseExploreFilters(new URLSearchParams()),
        })
      )?.total,
      0,
    );
    for (const key of keys)
      assert.equal(await ctx.store.get(key, 10485760), null);
    const result = await createTrack({ db, ...ctx, read });
    assert.equal(
      (await getTrack({ db, ...ctx, id: result.ids[0] }))?.photos[0]?.caption,
      "Still staged",
    );
    assert.equal(
      (await getTrack({ db, ...ctx, id: result.ids[1] }))?.photos.length,
      0,
    );
  }));

test("multi-track lost commit acknowledgements resolve to the same complete ordered set without cleanup removing files", async () =>
  fixture(async (ctx) => {
    const requestId = randomUUID();
    const read = async () => ({ requestId, input, bytes: multiGpx });
    const restore = loseReadyFileCommit(pool);
    try {
      await assert.rejects(createTrack({ db, ...ctx, read }));
    } finally {
      restore();
    }
    await cleanupFiles({ db, store: ctx.store });
    const result = await createTrack({ db, ...ctx, read });
    assert.equal(result.ids.length, 2);
    for (const id of result.ids)
      assert.ok((await downloadTrack({ db, ...ctx, id })).bytes.length);
    assert.deepEqual(await createTrack({ db, ...ctx, read }), result);
    await assert.rejects(
      createTrack({
        db,
        ...ctx,
        read: async () => ({
          ...(await read()),
          input: { ...input, description: "Changed" },
        }),
      }),
      code("conflict"),
    );
    await assert.rejects(
      createTrack({
        db,
        ...ctx,
        read: async () => ({
          ...(await read()),
          bytes: Buffer.from(multiGpx.toString().replace("Second", "Changed")),
        }),
      }),
      code("conflict"),
    );
  }));

function documentRequest(bytes: Buffer, requestId = randomUUID()) {
  const origin = "https://atlas.example";
  const form = new FormData();
  for (const [key, value] of Object.entries({
    ...input,
    difficulty: String(input.difficulty),
    tags: JSON.stringify(input.tags),
    requestId,
  }))
    form.set(key, value);
  form.set(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "application/gpx+xml" }),
    "document.gpx",
  );
  return new Request(`${origin}/api/tracks`, {
    method: "POST",
    headers: { origin },
    body: form,
  });
}

test("HTTP multi-track creation returns ordered IDs, rejects indexed invalid documents and enforces independent download access", async () =>
  fixture(async (ctx) => {
    const deps = { db, ...ctx, origin: "https://atlas.example" };
    const requestId = randomUUID();
    const response = await handleTrackRequest(
      documentRequest(multiGpx, requestId),
      deps,
    );
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.ids.length, 2);
    assert.equal(result.id, result.ids[0]);
    assert.deepEqual(
      await (
        await handleTrackRequest(documentRequest(multiGpx, requestId), deps)
      ).json(),
      result,
    );
    const invalid = Buffer.from(
      multiGpx.toString().replace('<trkpt lat="1" lon="1.01"/>', ""),
    );
    const rejected = await handleTrackRequest(documentRequest(invalid), deps);
    assert.equal(rejected.status, 422);
    assert.deepEqual(await rejected.json(), {
      error: "invalidSegment",
      track: 2,
      segment: 1,
    });
    const tooMany = Buffer.from(
      gpx
        .toString()
        .replace(
          "</gpx>",
          '<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1" lon="1.01"/></trkseg></trk>'.repeat(
            100,
          ) + "</gpx>",
        ),
    );
    const limited = await handleTrackRequest(documentRequest(tooMany), deps);
    assert.equal(limited.status, 422);
    assert.deepEqual(await limited.json(), { error: "tooManyTracks" });
    for (const [index, id] of result.ids.entries()) {
      const request = () =>
        new Request(`https://atlas.example/api/tracks/${id}/download`);
      assert.equal(
        (await handleTrackRequest(request(), { ...deps, token: undefined }, id))
          .status,
        401,
      );
      await fixture(async (other) => {
        assert.equal(
          (
            await handleTrackRequest(
              request(),
              { ...deps, token: other.token },
              id,
            )
          ).status,
          404,
        );
        await assert.rejects(
          deleteTrack({ db, ...other, id }),
          code("notFound"),
        );
      });
      const download = await handleTrackRequest(request(), deps, id);
      assert.equal(download.status, 200);
      assert.equal((await download.text()).includes("Second"), index === 1);
    }
    assert.equal(
      (
        await getExploreResults({
          db,
          ...ctx,
          ownerId: ctx.userId,
          filters: parseExploreFilters(new URLSearchParams()),
        })
      )?.total,
      2,
    );
  }));

async function seedQuotaFiles(
  ctx: { userId: string; store: ObjectStore },
  sizes: number[],
  purpose: "gpx" | "photo" = "gpx",
) {
  await db.insert(storedFiles).values(
    sizes.map((byteSize) => {
      const id = randomUUID();
      return {
        id,
        ownerId: ctx.userId,
        purpose,
        status: "ready" as const,
        storageLocation: ctx.store.location,
        objectKey: id,
        byteSize,
        contentType: purpose === "gpx" ? "application/gpx+xml" : "image/png",
        sha256: "a".repeat(64),
      };
    }),
  );
}

test("whole-document quota reservations serialize at the final file slots and reject sets that do not fit", async () =>
  fixture(async (ctx) => {
    await seedQuotaFiles(
      ctx,
      Array.from({ length: 97 }, () => 1),
    );
    const read = () => async () => ({
      requestId: randomUUID(),
      input,
      bytes: multiGpx,
    });
    const results = await Promise.allSettled([
      createTrack({ db, ...ctx, read: read() }),
      createTrack({ db, ...ctx, read: read() }),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    assert.ok(code("quotaExceeded")(rejected.reason));
    const tracks = await getExploreResults({
      db,
      ...ctx,
      ownerId: ctx.userId,
      filters: parseExploreFilters(new URLSearchParams()),
    });
    assert.equal(tracks?.total, 2);
    // Exactly one slot remains; a two-output document must publish neither.
    await assert.rejects(
      createTrack({ db, ...ctx, read: read() }),
      code("quotaExceeded"),
    );
    assert.equal(
      (
        await getExploreResults({
          db,
          ...ctx,
          ownerId: ctx.userId,
          filters: parseExploreFilters(new URLSearchParams()),
        })
      )?.total,
      2,
    );
  }));

test("byte reservations use actual isolated outputs rather than original multi-track bytes or per-file maxima", async () =>
  fixture(async (ctx) => {
    const maximumPhoto = 44 * 1024 * 1024;
    await seedQuotaFiles(
      ctx,
      [
        ...Array.from({ length: 23 }, () => maximumPhoto),
        1024 * 1024 * 1024 - 23 * maximumPhoto - 2048,
      ],
      "photo",
    );
    const bytes = Buffer.from(
      multiGpx
        .toString()
        .replace(
          "<trk>",
          `<metadata><desc>${"x".repeat(100000)}</desc></metadata><trk>`,
        ),
    );
    let storedBytes = 0;
    const store: ObjectStore = {
      ...ctx.store,
      put: async (key, value, type) => {
        storedBytes += value.length;
        await ctx.store.put(key, value, type);
      },
    };
    const result = await createTrack({
      db,
      ...ctx,
      store,
      read: async () => ({ requestId: randomUUID(), input, bytes }),
    });
    assert.equal(result.ids.length, 2);
    assert.ok(storedBytes > 0 && storedBytes < 2048);
    assert.ok(bytes.length > 100000);
    for (const id of result.ids)
      assert.ok(
        !(await downloadTrack({ db, ...ctx, id })).bytes.includes(
          Buffer.from("<metadata>"),
        ),
      );
  }));

test("insufficient aggregate byte quota stores and publishes no output", async () =>
  fixture(async (ctx) => {
    const maximumPhoto = 44 * 1024 * 1024;
    await seedQuotaFiles(
      ctx,
      [
        ...Array.from({ length: 23 }, () => maximumPhoto),
        1024 * 1024 * 1024 - 23 * maximumPhoto - 1,
      ],
      "photo",
    );
    let writes = 0;
    const store: ObjectStore = {
      ...ctx.store,
      put: async () => {
        writes++;
      },
    };
    await assert.rejects(
      createTrack({
        db,
        ...ctx,
        store,
        read: async () => ({ requestId: randomUUID(), input, bytes: multiGpx }),
      }),
      code("quotaExceeded"),
    );
    assert.equal(writes, 0);
    assert.equal(
      (
        await getExploreResults({
          db,
          ...ctx,
          ownerId: ctx.userId,
          filters: parseExploreFilters(new URLSearchParams()),
        })
      )?.total,
      0,
    );
  }));

test("administration and spatial search read independent outputs, and permanent erasure removes the whole account's receipts", async () =>
  fixture(async (ctx) => {
    const result = await createTrack({
      db,
      ...ctx,
      read: async () => ({
        requestId: randomUUID(),
        input: { ...input, visibility: "public" },
        bytes: multiGpx,
      }),
    });
    const spatial = await getExploreResults({
      db,
      token: undefined,
      ownerId: ctx.userId,
      filters: parseExploreFilters(
        new URLSearchParams({ viewport: "0.99,0.99,1.02,1.02" }),
      ),
    });
    assert.equal(spatial?.total, 1);
    assert.equal(spatial?.tracks[0]?.id, result.ids[1]);
    await fixture(async (admin) => {
      await db
        .update(users)
        .set({ admin: true })
        .where(eq(users.id, admin.userId));
      const page = await listAdminRecords(
        db,
        admin.token,
        "tracks",
        new URLSearchParams({ owner_id: ctx.userId }),
      );
      assert.equal(page.total, 2);
      const originals = new Set<string>();
      for (const id of result.ids) {
        const detail = await getAdminRecord(
          db,
          admin.token,
          "tracks",
          JSON.stringify([id]),
        );
        assert.equal(detail.record.values.id, id);
        originals.add(String(detail.record.values.original_file_id));
      }
      assert.equal(originals.size, 2);
    });
    const erasing = await eraseAccount({
      db,
      userId: ctx.userId,
      confirmation: ctx.userId,
      stores: [ctx.store],
    });
    assert.equal(erasing.status, "pending");
    for (const id of result.ids)
      assert.equal(await getTrack({ db, token: undefined, id }), null);
    // Advance only this fixture's retained deletion rows, as in the erasure suite.
    await db
      .update(storedFiles)
      .set({ deleteAfter: sql`clock_timestamp()-interval '1 second'` })
      .where(eq(storedFiles.ownerId, ctx.userId));
    const complete = await eraseAccount({
      db,
      userId: ctx.userId,
      confirmation: ctx.userId,
      stores: [ctx.store],
    });
    assert.equal(complete.status, "complete");
    assert.equal(
      (
        await db
          .select()
          .from(trackUploadAttempts)
          .where(eq(trackUploadAttempts.ownerId, ctx.userId))
      ).length,
      0,
    );
    assert.equal(
      (
        await db
          .select()
          .from(deletedTrackUploads)
          .where(eq(deletedTrackUploads.ownerId, ctx.userId))
      ).length,
      0,
    );
  }));

test("a fresh account can atomically publish all 100 ordered outputs within the shared upload limits", async () =>
  fixture(async (ctx) => {
    const track =
      '<trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.01"/></trkseg></trk>';
    const bytes = Buffer.from(
      `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test">${track.repeat(100)}</gpx>`,
    );
    const requestId = randomUUID();
    const read = async () => ({ requestId, input, bytes });
    const result = await createTrack({ db, ...ctx, read });
    assert.equal(result.ids.length, 100);
    const confirmation = await getTrackUploadResult({
      db,
      token: ctx.token,
      requestId,
    });
    assert.deepEqual(
      confirmation?.tracks.map((track) => track.id),
      result.ids,
    );
    assert.equal(confirmation?.tracks[99].name, "Test track 100");
    assert.equal(new Set(result.ids).size, 100);
    assert.equal(
      (await getTrack({ db, ...ctx, id: result.ids[99] }))?.name,
      "Test track 100",
    );
    assert.deepEqual(await createTrack({ db, ...ctx, read }), result);
    await assert.rejects(upload(ctx), code("quotaExceeded"));
  }));

test("ordered receipts preserve immutable per-output GPX associations when another owned ready file exists", async () =>
  fixture(async (ctx) => {
    const result = await createTrack({
      db,
      ...ctx,
      read: async () => ({ requestId: randomUUID(), input, bytes: multiGpx }),
    });
    const other = await uploadFile({
      db,
      ...ctx,
      purpose: "gpx",
      contentType: "application/gpx+xml",
      read: async () => gpx,
    });
    for (const id of result.ids)
      await assert.rejects(
        db
          .update(tracks)
          .set({ originalFileId: other.id })
          .where(eq(tracks.id, id)),
      );
    assert.equal(
      (await downloadTrack({ db, ...ctx, id: result.ids[1] })).bytes
        .toString()
        .includes("Second"),
      true,
    );
  }));

test("an expired multi-track generation cannot write or clean its replacement's isolated files", async () =>
  fixture(async (ctx) => {
    const requestId = randomUUID();
    const read = async () => ({ requestId, input, bytes: multiGpx });
    const started = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const store: ObjectStore = {
      ...ctx.store,
      put: async (...args) => {
        await ctx.store.put(...args);
        started.resolve();
        await release.promise;
      },
    };
    const stale = createTrack({ db, ...ctx, store, read });
    const rejected = assert.rejects(stale);
    let replacement: Awaited<ReturnType<typeof createTrack>> | undefined;
    try {
      await started.promise;
      await db
        .update(storedFiles)
        .set({ expiresAt: sql`clock_timestamp()-interval '1 second'` })
        .where(eq(storedFiles.ownerId, ctx.userId));
      replacement = await createTrack({ db, ...ctx, read });
    } finally {
      release.resolve();
    }
    await rejected;
    assert.ok(replacement);
    await cleanupFiles({ db, store: ctx.store });
    assert.deepEqual(await createTrack({ db, ...ctx, read }), replacement);
    for (const id of replacement.ids)
      assert.ok((await downloadTrack({ db, ...ctx, id })).bytes.length);
  }));

test("upload confirmation returns only the current owner's complete ordered authorized output set", async () =>
  fixture(async (ctx) => {
    const requestId = randomUUID();
    const result = await createTrack({
      db,
      ...ctx,
      read: async () => ({ requestId, input, bytes: multiGpx }),
    });
    assert.deepEqual(
      await getTrackUploadResult({ db, token: ctx.token, requestId }),
      {
        ownerId: ctx.userId,
        tracks: [
          { id: result.ids[0], name: "Test track 1" },
          { id: result.ids[1], name: "Test track 2" },
        ],
      },
    );
    assert.equal(
      await getTrackUploadResult({ db, token: undefined, requestId }),
      null,
    );
    assert.equal(
      await getTrackUploadResult({ db, token: ctx.token, requestId: "unsafe" }),
      null,
    );
    assert.equal(
      await getTrackUploadResult({
        db,
        token: ctx.token,
        requestId: randomUUID(),
      }),
      null,
    );
    await fixture(async (other) => {
      assert.equal(
        await getTrackUploadResult({ db, token: other.token, requestId }),
        null,
      );
    });
    await deleteTrack({ db, token: ctx.token, id: result.ids[1] });
    assert.equal(
      await getTrackUploadResult({ db, token: ctx.token, requestId }),
      null,
    );
  }));

for (const version of ["1.0", "1.1"]) {
  test(`GPX ${version} HTTP downloads preserve complete recorded data through independent privacy and deletion`, async () =>
    fixture(async (ctx) => {
      const bytes = await readFile(
        new URL(`../fixtures/gpx/multi-track-${version}.gpx`, import.meta.url),
      );
      const expected = await processGpxDocument(bytes);
      const requestId = randomUUID();
      const deps = { db, ...ctx, origin: "https://atlas.example" };
      const created = await handleTrackRequest(
        documentRequest(bytes, requestId),
        deps,
      );
      assert.equal(created.status, 201);
      const result = await created.json();
      assert.equal(result.ids.length, 2);
      const downloads: Buffer[] = [];
      for (const [index, id] of (result.ids as string[]).entries()) {
        const response = await handleTrackRequest(
          new Request(`https://atlas.example/api/tracks/${id}/download`),
          deps,
          id,
        );
        assert.equal(response.status, 200);
        assert.equal(
          response.headers.get("cache-control"),
          "private, no-store",
        );
        const download = Buffer.from(await response.arrayBuffer());
        downloads.push(download);
        assert.deepEqual(download, Buffer.from(expected.tracks[index].gpx));
        assert.deepEqual(parseGpx(download), expected.tracks[index].data);
        const detailResponse = await handleTrackRequest(
          new Request(`https://atlas.example/api/tracks/${id}/data`),
          deps,
          id,
          "data",
        );
        assert.equal(detailResponse.status, 200);
        assert.deepEqual((await detailResponse.json()).waypoints, []);
        const data = await getTrackData({ db, ...ctx, id });
        assert.deepEqual(data, {
          geometry: expected.tracks[index].data.geometry,
          samples: expected.tracks[index].data.samples,
          segmentStarts: expected.tracks[index].data.segmentStarts,
        });
      }
      await updateTrack({
        db,
        ...ctx,
        id: result.ids[0],
        input: { ...input, name: "Published ridge", visibility: "public" },
      });
      assert.equal(
        await getTrack({ db, token: undefined, id: result.ids[1] }),
        null,
      );
      assert.equal(
        (await getTrack({ db, token: undefined, id: result.ids[0] }))?.name,
        "Published ridge",
      );
      await deleteTrack({ db, ...ctx, id: result.ids[1] });
      await cleanupFiles({ db, store: ctx.store });
      assert.deepEqual(
        (await downloadTrack({ db, ...ctx, id: result.ids[0] })).bytes,
        downloads[0],
      );
      const replay = await handleTrackRequest(
        documentRequest(bytes, requestId),
        deps,
      );
      assert.equal(replay.status, 404);
      assert.deepEqual(await replay.json(), { error: "notFound" });
    }));
}

test("public discovery never inherits owner access and follows publication eligibility", async () => {
  const { getPublicTrack, listPublicTracks } =
    await import("../../tracks/public");
  await fixture(async ({ token, store, userId }) => {
    const { id } = await createTrack({
      db,
      store,
      token,
      read: async () => ({
        requestId: randomUUID(),
        input: { ...input, visibility: "private" },
        bytes: gpx,
      }),
    });
    assert.ok(await getTrack({ db, token, id }));
    assert.equal(await getPublicTrack(db, id), null);
    assert.ok(!(await listPublicTracks(db)).some((t) => t.id === id));
    await updateTrack({
      db,
      token,
      id,
      input: { ...input, visibility: "public" },
    });
    assert.equal((await getPublicTrack(db, id))?.name, "Test track");
    assert.ok((await listPublicTracks(db)).some((t) => t.id === id));
    await db.update(users).set({ active: false }).where(eq(users.id, userId));
    assert.equal(await getPublicTrack(db, id), null);
    assert.ok(!(await listPublicTracks(db)).some((t) => t.id === id));
    await db.update(users).set({ active: true }).where(eq(users.id, userId));
    await deleteTrack({ db, token, id });
    assert.equal(await getPublicTrack(db, id), null);
    assert.ok(!(await listPublicTracks(db)).some((t) => t.id === id));
    assert.equal(await getPublicTrack(db, "invalid"), null);
  });
});

test("upload-scoped explorer restricts results counts and bounds to owned outputs across filters and deletion", async () =>
  fixture(async (ctx) => {
    await createTrack({
      db,
      ...ctx,
      read: async () => ({
        requestId: randomUUID(),
        input: { ...input, name: "Older unrelated track" },
        bytes: gpx,
      }),
    });
    const requestId = randomUUID();
    const result = await createTrack({
      db,
      ...ctx,
      read: async () => ({ requestId, input, bytes: multiGpx }),
    });
    const read = (query: string, token: string | null = ctx.token) =>
      handleExploreRequest(
        new Request(`http://localhost/api/tracks/explore?${query}`),
        { db, token: token ?? undefined },
      );
    const query = `ownerId=${ctx.userId}&created=${requestId}`;
    const response = await read(query);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.total, 2);
    assert.equal(body.scopeCount, 2);
    assert.deepEqual(
      body.tracks.map((track: { id: string }) => track.id).sort(),
      [...result.ids].sort(),
    );
    const filtered = await (await read(`${query}&q=Older`)).json();
    assert.equal(filtered.total, 0);
    assert.equal(filtered.scopeCount, 2);
    assert.deepEqual(filtered.bounds, body.bounds);
    assert.equal((await read(query, null)).status, 404);
    await fixture(async (other) => {
      assert.equal((await read(query, other.token)).status, 404);
      const foreign = await (
        await read(`ownerId=${other.userId}&created=${requestId}`, other.token)
      ).json();
      assert.equal(foreign.total, 0);
    });
    for (const invalid of [
      `created=${requestId}`,
      `${query}&created=${requestId}`,
      `ownerId=${ctx.userId}&created=bad`,
      `${query}&unknown=1`,
    ])
      assert.equal((await read(invalid)).status, 400);
    const all = await (await read(`ownerId=${ctx.userId}`)).json();
    assert.equal(all.total, 3);
    await deleteTrack({ db, token: ctx.token, id: result.ids[1] });
    const remaining = await (await read(query)).json();
    assert.equal(remaining.total, 1);
    assert.equal(remaining.tracks[0].id, result.ids[0]);
  }));

test("retained singleton waypoint HTTP reads authorize before private storage, preserve downloads and exclude explorer data", async () =>
  fixture(async (ctx) => {
    const bytes = Buffer.from(
      gpx
        .toString()
        .replace(
          "<trk>",
          '<wpt lat="0" lon="0"><name>Spring</name><desc>&lt;script&gt;plain&lt;/script&gt;</desc></wpt><wpt lat="70" lon="80"/><wpt lat="bad" lon="0"/><trk>',
        ),
    );
    const { id } = await createTrack({
      db,
      ...ctx,
      read: async () => ({ requestId: randomUUID(), input, bytes }),
    });
    const request = () => new Request(`http://localhost/api/tracks/${id}/data`);
    const read = (token: string | undefined = ctx.token, store = ctx.store) =>
      handleTrackRequest(
        request(),
        { db, ...ctx, store, token, origin: "http://localhost" },
        id,
        "data",
      );
    const expected = [
      {
        position: [0, 0],
        name: "Spring",
        description: "<script>plain</script>",
      },
      { position: [80, 70], name: "", description: "" },
    ];
    const response = await read();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual((await response.json()).waypoints, expected);
    assert.deepEqual((await downloadTrack({ db, ...ctx, id })).bytes, bytes);
    const guest = () =>
      handleTrackRequest(
        request(),
        { db, ...ctx, token: undefined, origin: "http://localhost" },
        id,
        "data",
      );
    assert.equal((await guest()).status, 404);
    await fixture(async (foreign) =>
      assert.equal((await read(foreign.token)).status, 404),
    );
    await updateTrack({
      db,
      token: ctx.token,
      id,
      input: { ...input, visibility: "public" },
    });
    assert.deepEqual((await (await guest()).json()).waypoints, expected);
    const explorer = await getExploreResults({
      db,
      token: undefined,
      filters: parseExploreFilters(new URLSearchParams()),
    });
    assert.ok(!JSON.stringify(explorer).includes("Spring"));
    assert.ok(!JSON.stringify(explorer).includes("waypoints"));
    const geometry = await getExploreGeometry({ db, token: undefined, id });
    assert.ok(!JSON.stringify(geometry).includes("waypoints"));
    const broken = { ...ctx.store, get: async () => Buffer.from("corrupt") };
    assert.equal((await read(ctx.token, broken)).status, 503);
    await db
      .update(users)
      .set({ active: false })
      .where(eq(users.id, ctx.userId));
    assert.equal((await guest()).status, 404);
  }));

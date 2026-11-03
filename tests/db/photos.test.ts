import { createAcceptedSession as createSession } from "../helpers/accepted-session";
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { loadEnvConfig } from "@next/env";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import {
  users,
  storedFiles,
  tracks,
  trackPhotos,
  trackPhotoVersions,
  deletedTrackUploads,
} from "../../db/schema";
import {
  uploadFile,
  downloadFile,
  deleteFile,
  cleanupFiles,
} from "../../storage/files";
import { createObjectStore } from "../../storage/objects";
import { getStorageConfig } from "../../storage/config";
import {
  createTrack,
  updateTrack,
  getTrack,
  deleteTrack,
} from "../../tracks/service";
import { mutateAdminRecords } from "../../admin/mutations";
import { photoVersionKey } from "../../storage/photo-versions";
import { signupFixture } from "./auth-helpers";
loadEnvConfig(process.cwd(), true);
const url = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error("Photo tests require loopback development database");
const { db, pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
test("staged photos publish atomically, reject foreign references, preserve cancel, withdraw on deletion and clean all objects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "atlas-photos-"));
  const store = createObjectStore(
    getStorageConfig({
      NODE_ENV: "development",
      FILE_STORAGE_LOCAL_DIR: directory,
    }),
  );
  const ids: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const [user] = await db
        .insert(users)
        .values({
          ...signupFixture(),
          passwordHash: "synthetic",
          emailConfirmed: true,
        })
        .returning();
      ids.push(user.id);
    }
    const token = (await createSession(db, ids[0])).token,
      other = (await createSession(db, ids[1])).token;
    const original = await sharp({
      create: { width: 30, height: 20, channels: 3, background: "blue" },
    })
      .jpeg()
      .withMetadata()
      .toBuffer();
    const photo = await uploadFile({
      db,
      store,
      token,
      purpose: "photo",
      contentType: "image/jpeg",
      read: async () => original,
    });
    assert.deepEqual(
      (await downloadFile({ db, store, token, id: photo.id })).bytes,
      original,
    );
    await assert.rejects(
      downloadFile({ db, store, token: other, id: photo.id }),
    );
    const metadata = {
      name: "Photo track",
      description: "Test gallery",
      activity: "hiking",
      difficulty: 2,
      tags: [],
      visibility: "public",
    };
    const bytes = Buffer.from(
      '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg><trkpt lat="40" lon="-3"/><trkpt lat="40.1" lon="-3.1"/></trkseg></trk></gpx>',
    );
    const track = await createTrack({
      db,
      store,
      token,
      read: async () => ({
        requestId: randomUUID(),
        input: { ...metadata, photos: [{ id: photo.id, caption: "Saved" }] },
        bytes,
      }),
    });
    assert.deepEqual(
      (await getTrack({ db, token: undefined, id: track.id }))?.photos,
      [{ id: photo.id, caption: "Saved" }],
    );
    await assert.rejects(deleteFile({ db, store, token, id: photo.id }));
    await assert.rejects(
      updateTrack({
        db,
        token,
        id: track.id,
        input: {
          ...metadata,
          name: "Should roll back",
          photos: [{ id: randomUUID(), caption: "" }],
        },
      }),
    );
    assert.equal(
      (await getTrack({ db, token, id: track.id }))?.name,
      "Photo track",
    );
    await assert.rejects(
      updateTrack({
        db,
        token: other,
        id: track.id,
        input: { ...metadata, photos: [] },
      }),
    );
    await db
      .update(storedFiles)
      .set({ expiresAt: sql`clock_timestamp()-interval '1 hour'` })
      .where(eq(storedFiles.id, photo.id));
    await cleanupFiles({ db, store });
    assert.equal(
      (await getTrack({ db, token, id: track.id }))?.photos.length,
      1,
    );
    await deleteTrack({ db, token, id: track.id });
    await assert.rejects(downloadFile({ db, store, token, id: photo.id }));
    assert.equal((await cleanupFiles({ db, store })).failed, 0);
    const abandoned = await uploadFile({
      db,
      store,
      token,
      purpose: "photo",
      contentType: "image/jpeg",
      read: async () => original,
    });
    await db
      .update(storedFiles)
      .set({ expiresAt: sql`clock_timestamp()-interval '1 hour'` })
      .where(eq(storedFiles.id, abandoned.id));
    // Expired staging cannot be revived through Save, even by its owner.
    await assert.rejects(
      createTrack({
        db,
        store,
        token,
        read: async () => ({
          requestId: randomUUID(),
          input: {
            ...metadata,
            photos: [{ id: abandoned.id, caption: "Retained caption" }],
          },
          bytes,
        }),
      }),
    );
    // Recovery uses a fresh, normally authorized and quota-accounted upload.
    const replacement = await uploadFile({
      db,
      store,
      token,
      purpose: "photo",
      contentType: "image/jpeg",
      read: async () => original,
    });
    await assert.rejects(
      createTrack({
        db,
        store,
        token: other,
        read: async () => ({
          requestId: randomUUID(),
          input: {
            ...metadata,
            photos: [{ id: replacement.id, caption: "Retained caption" }],
          },
          bytes,
        }),
      }),
    );
    const recovered = await createTrack({
      db,
      store,
      token,
      read: async () => ({
        requestId: randomUUID(),
        input: {
          ...metadata,
          photos: [{ id: replacement.id, caption: "Retained caption" }],
        },
        bytes,
      }),
    });
    assert.deepEqual(
      (await getTrack({ db, token, id: recovered.id }))?.photos,
      [{ id: replacement.id, caption: "Retained caption" }],
    );
    await deleteTrack({ db, token, id: recovered.id });
    await cleanupFiles({ db, store });
    await assert.rejects(downloadFile({ db, store, token, id: abandoned.id }));
  } finally {
    for (const id of ids) {
      await db.delete(tracks).where(eq(tracks.ownerId, id));
      await db.delete(storedFiles).where(eq(storedFiles.ownerId, id));
      await db.delete(users).where(eq(users.id, id));
    }
    await rm(directory, { recursive: true, force: true });
  }
});

for (const caller of ["owner", "Administrator"] as const) {
  test(`${caller} deletion retains identity and withdraws photo-bearing Tracks across failed and completed cleanup`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-deletion-"));
    const store = createObjectStore(
      getStorageConfig({
        NODE_ENV: "development",
        FILE_STORAGE_LOCAL_DIR: directory,
      }),
    );
    const ids: string[] = [];
    try {
      for (let i = 0; i < 2; i++) {
        const [user] = await db
          .insert(users)
          .values({
            ...signupFixture(),
            passwordHash: "synthetic",
            emailConfirmed: true,
            admin: i === 1,
          })
          .returning();
        ids.push(user.id);
      }
      const token = (await createSession(db, ids[0])).token;
      const admin = (await createSession(db, ids[1])).token;
      const original = await sharp({
        create: { width: 30, height: 20, channels: 3, background: "blue" },
      })
        .jpeg()
        .toBuffer();
      const photo = await uploadFile({
        db,
        store,
        token,
        purpose: "photo",
        contentType: "image/jpeg",
        read: async () => original,
      });
      const requestId = randomUUID();
      const read = async () => ({
        requestId,
        input: {
          name: "Deleted gallery",
          description: "Lifecycle",
          activity: "hiking",
          difficulty: 2,
          tags: ["hill"],
          visibility: "public",
          photos: [{ id: photo.id, caption: "Saved" }],
        },
        bytes: Buffer.from(
          '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg><trkpt lat="40" lon="-3"/><trkpt lat="40.1" lon="-3.1"/></trkseg></trk></gpx>',
        ),
      });
      const { id } = await createTrack({ db, store, token, read });
      const [track] = await db.select().from(tracks).where(eq(tracks.id, id));
      const versions = await db
        .select()
        .from(trackPhotoVersions)
        .where(eq(trackPhotoVersions.photoId, photo.id));
      assert.equal(versions.length, 6);
      const [photoFile] = await db
        .select()
        .from(storedFiles)
        .where(eq(storedFiles.id, photo.id));
      const keys = [
        track.originalFileId,
        photoFile.objectKey,
        ...versions.map((v) => photoVersionKey(photo.id, v.size, v.format)),
      ];
      const remove = () =>
        caller === "owner"
          ? deleteTrack({ db, token, id })
          : mutateAdminRecords(db, admin, {
              model: "tracks",
              operation: "delete",
              ids: [JSON.stringify([id])],
            });
      assert.ok(await getTrack({ db, token: undefined, id }));
      await remove();
      assert.equal(await getTrack({ db, token: undefined, id }), null);
      await assert.rejects(downloadFile({ db, store, token, id: photo.id }), {
        code: "notFound",
      });
      const [withdrawn] = await db
        .select()
        .from(trackPhotos)
        .where(eq(trackPhotos.id, photo.id));
      assert.equal(withdrawn.trackId, null);
      const queued = await db
        .select()
        .from(storedFiles)
        .where(eq(storedFiles.ownerId, ids[0]));
      assert.equal(queued.length, 2);
      assert.ok(queued.every((f) => f.status === "deleting"));
      // Queueing only: no physical removal inside either caller's transaction.
      for (const key of keys) assert.ok(await store.get(key, 20 * 1024 * 1024));
      assert.equal(
        (
          await db
            .select()
            .from(deletedTrackUploads)
            .where(
              and(
                eq(deletedTrackUploads.ownerId, ids[0]),
                eq(deletedTrackUploads.requestId, requestId),
              ),
            )
        )[0]?.trackId,
        id,
      );
      await assert.rejects(createTrack({ db, store, token, read }), {
        code: "notFound",
      });
      assert.equal(
        (
          await cleanupFiles({
            db,
            store: {
              ...store,
              remove: async () => {
                throw new Error("storage unavailable");
              },
            },
          })
        ).failed,
        2,
      );
      assert.equal(
        (
          await db
            .select()
            .from(storedFiles)
            .where(eq(storedFiles.ownerId, ids[0]))
        ).length,
        2,
      );
      assert.equal(await getTrack({ db, token, id }), null);
      assert.equal((await cleanupFiles({ db, store })).failed, 0);
      for (const key of keys)
        assert.equal(await store.get(key, 20 * 1024 * 1024), null);
      // Photo deletion metadata remains quota-accounted for 24 hours against late writes.
      assert.equal(
        (
          await db
            .select()
            .from(storedFiles)
            .where(eq(storedFiles.ownerId, ids[0]))
        ).length,
        1,
      );
      await db
        .update(storedFiles)
        .set({ deleteAfter: sql`clock_timestamp()-interval '1 second'` })
        .where(eq(storedFiles.id, photo.id));
      await cleanupFiles({ db, store });
      assert.equal(
        (
          await db
            .select()
            .from(storedFiles)
            .where(eq(storedFiles.ownerId, ids[0]))
        ).length,
        0,
      );
      assert.equal(
        (
          await db
            .select()
            .from(trackPhotoVersions)
            .where(eq(trackPhotoVersions.photoId, photo.id))
        ).length,
        0,
      );
      const [receipt] = await db
        .select()
        .from(deletedTrackUploads)
        .where(
          and(
            eq(deletedTrackUploads.ownerId, ids[0]),
            eq(deletedTrackUploads.requestId, requestId),
          ),
        );
      assert.equal(receipt.trackId, id);
      await assert.rejects(createTrack({ db, store, token, read }), {
        code: "notFound",
      });
      // Even dropping the now-cleaned photo from a delayed retry cannot reuse this identity.
      await assert.rejects(
        createTrack({
          db,
          store,
          token,
          read: async () => {
            const payload = await read();
            return { ...payload, input: { ...payload.input, photos: [] } };
          },
        }),
        { code: "notFound" },
      );
      if (caller === "owner")
        await remove(); // Lost acknowledgements remain safe after cleanup.
      else await assert.rejects(remove(), { code: "notFound" });
    } finally {
      for (const id of ids) {
        await db.execute(
          sql`DELETE FROM track_photos WHERE id IN (SELECT id FROM stored_files WHERE owner_id=${id})`,
        );
        await db.delete(tracks).where(eq(tracks.ownerId, id));
        await db.delete(storedFiles).where(eq(storedFiles.ownerId, id));
        await db.delete(users).where(eq(users.id, id));
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
}

import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, or, sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { findSessionUser, isSessionToken } from "../auth/session-store";
import {
  users,
  sessions,
  storedFiles,
  tracks,
  trackData,
  trackTags,
  trackRepresentations,
  trackUploadAttempts,
} from "../db/schema";
import { avatarVersionKey } from "../storage/avatar-versions";
import type { ObjectStore } from "../storage/objects";
import { hasUploadCapacity } from "../storage/quota";
import { processGpx } from "./gpx";
import {
  TrackError,
  trackIdPattern,
  validateTrackInput,
  tagKey,
} from "./validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type TrackDependencies = { db: Database; token: string | undefined };
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

async function asUploader<T>(
  { db, token }: TrackDependencies,
  work: (tx: Transaction, ownerId: string) => Promise<T>,
): Promise<T> {
  if (!isSessionToken(token)) throw new TrackError("unauthorized");
  const identity = await findSessionUser(db, token);
  if (!identity) throw new TrackError("unauthorized");
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ active: users.active, confirmed: users.emailConfirmed })
      .from(users)
      .where(eq(users.id, identity.userId))
      .for("update");
    if (!owner?.active) throw new TrackError("unauthorized");
    const [session] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, identity.userId),
          eq(sessions.tokenHash, digest(token)),
          gt(sessions.expiresAt, sql`clock_timestamp()`),
        ),
      )
      .for("update");
    if (!session) throw new TrackError("unauthorized");
    if (!owner.confirmed) throw new TrackError("emailUnconfirmed");
    return work(tx, identity.userId);
  });
}
export async function requireTrackUploader(dependencies: TrackDependencies) {
  await asUploader(dependencies, async () => {});
}

/** One logical submission. read is invoked only after authorization. */
export async function createTrack(
  dependencies: TrackDependencies & {
    store: ObjectStore;
    read: () => Promise<{ requestId: string; input: unknown; bytes: Buffer }>;
  },
): Promise<{ id: string }> {
  const { db, store } = dependencies;
  await requireTrackUploader(dependencies);
  const payload = await dependencies.read();
  if (!trackIdPattern.test(payload.requestId))
    throw new TrackError("invalidRequest");
  const input = validateTrackInput(payload.input);
  if (payload.bytes.length > 10 * 1024 * 1024) throw new TrackError("tooLarge");
  if (!payload.bytes.length) throw new TrackError("invalidFile");
  // Private requests retain the canonical shape used before public uploads.
  // Public visibility must still bind the request to a different fingerprint.
  const { visibility, ...metadata } = input;
  const fingerprintInput = visibility === "private" ? metadata : input;
  const sha256 = digest(payload.bytes),
    fingerprint = digest(JSON.stringify({ input: fingerprintInput, sha256 }));
  const reservation = await asUploader(dependencies, async (tx, ownerId) => {
    const [attempt] = await tx
      .select({
        fingerprint: trackUploadAttempts.fingerprint,
        fileId: trackUploadAttempts.fileId,
        state: trackUploadAttempts.state,
        trackId: trackUploadAttempts.trackId,
        live: sql<boolean>`${storedFiles.expiresAt} > clock_timestamp()`,
      })
      .from(trackUploadAttempts)
      .innerJoin(storedFiles, eq(storedFiles.id, trackUploadAttempts.fileId))
      .where(
        and(
          eq(trackUploadAttempts.ownerId, ownerId),
          eq(trackUploadAttempts.requestId, payload.requestId),
        ),
      )
      .for("update");
    if (attempt) {
      if (attempt.fingerprint !== fingerprint) throw new TrackError("conflict");
      if (attempt.state === "complete" && attempt.trackId)
        return { trackId: attempt.trackId, ownerId };
      if (attempt.state === "pending" && attempt.live)
        throw new TrackError("processing");
      await tx
        .update(storedFiles)
        .set({
          status: "deleting",
          deleteAfter: sql`clock_timestamp()+interval '24 hours'`,
        })
        .where(
          and(
            eq(storedFiles.id, attempt.fileId),
            eq(storedFiles.status, "pending"),
          ),
        );
    }
    if (!(await hasUploadCapacity(tx, ownerId, 10 * 1024 * 1024)))
      throw new TrackError("quotaExceeded");
    const fileId = randomUUID();
    await tx.insert(storedFiles).values({
      id: fileId,
      ownerId,
      purpose: "gpx",
      objectKey: fileId,
      storageLocation: store.location,
      byteSize: 10 * 1024 * 1024,
    });
    await tx
      .insert(trackUploadAttempts)
      .values({
        ownerId,
        requestId: payload.requestId,
        fingerprint,
        fileId,
        state: "pending",
      })
      .onConflictDoUpdate({
        target: [trackUploadAttempts.ownerId, trackUploadAttempts.requestId],
        set: { fileId, state: "pending", trackId: null },
      });
    return { fileId, ownerId };
  });
  if ("trackId" in reservation && reservation.trackId)
    return { id: reservation.trackId };
  const fileId = reservation.fileId!;
  try {
    const processed = await processGpx(payload.bytes);
    await store.put(fileId, payload.bytes, "application/gpx+xml");
    return await asUploader(dependencies, async (tx, ownerId) => {
      const [attempt] = await tx
        .select()
        .from(trackUploadAttempts)
        .where(
          and(
            eq(trackUploadAttempts.ownerId, ownerId),
            eq(trackUploadAttempts.requestId, payload.requestId),
            eq(trackUploadAttempts.fileId, fileId),
            eq(trackUploadAttempts.state, "pending"),
          ),
        )
        .for("update");
      if (!attempt || attempt.fingerprint !== fingerprint)
        throw new TrackError("conflict");
      const [file] = await tx
        .update(storedFiles)
        .set({
          status: "ready",
          byteSize: payload.bytes.length,
          contentType: "application/gpx+xml",
          sha256,
        })
        .where(
          and(
            eq(storedFiles.id, fileId),
            eq(storedFiles.ownerId, ownerId),
            eq(storedFiles.status, "pending"),
            gt(storedFiles.expiresAt, sql`clock_timestamp()`),
          ),
        )
        .returning({ id: storedFiles.id });
      if (!file) throw new TrackError("conflict");
      const [track] = await tx
        .insert(tracks)
        .values({
          ownerId,
          originalFileId: fileId,
          requestId: payload.requestId,
          name: input.name,
          description: input.description,
          activity: input.activity,
          difficulty: input.difficulty,
          visibility: input.visibility,
          pointCount: processed.pointCount,
          distanceMeters: processed.distanceMeters,
          durationSeconds: processed.durationSeconds,
          ascentMeters: processed.ascentMeters,
          descentMeters: processed.descentMeters,
          minElevationMeters: processed.minElevationMeters,
          maxElevationMeters: processed.maxElevationMeters,
          elevationSampleCount: processed.elevationSampleCount,
          version: processed.version,
        })
        .returning({ id: tracks.id });
      await tx.insert(trackData).values({
        trackId: track.id,
        geometry: processed.geometry,
        samples: processed.samples,
      });
      await tx.insert(trackTags).values(
        input.tags.map((label, ordinal) => ({
          trackId: track.id,
          ordinal,
          label,
          normalizedKey: tagKey(label),
        })),
      );
      await tx.insert(trackRepresentations).values(
        processed.representations.map((value) => ({
          ...value,
          trackId: track.id,
          version: processed.version,
        })),
      );
      await tx
        .update(trackUploadAttempts)
        .set({ state: "complete", trackId: track.id })
        .where(
          and(
            eq(trackUploadAttempts.ownerId, ownerId),
            eq(trackUploadAttempts.requestId, payload.requestId),
            eq(trackUploadAttempts.fileId, fileId),
          ),
        );
      return { id: track.id };
    });
  } catch (error) {
    try {
      const abandoned = await db.transaction(async (tx) => {
        // Match publication's lock ordering, even when the session was revoked.
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, reservation.ownerId))
          .for("update");
        await tx
          .select()
          .from(trackUploadAttempts)
          .where(
            and(
              eq(trackUploadAttempts.ownerId, reservation.ownerId),
              eq(trackUploadAttempts.requestId, payload.requestId),
            ),
          )
          .for("update");
        const [file] = await tx
          .update(storedFiles)
          .set({
            status: "deleting",
            deleteAfter: sql`clock_timestamp()+interval '24 hours'`,
          })
          .where(
            and(eq(storedFiles.id, fileId), eq(storedFiles.status, "pending")),
          )
          .returning({ id: storedFiles.id });
        if (file)
          await tx
            .update(trackUploadAttempts)
            .set({ state: "failed" })
            .where(
              and(
                eq(trackUploadAttempts.fileId, fileId),
                eq(trackUploadAttempts.state, "pending"),
              ),
            );
        return file;
      });
      if (abandoned) await store.remove(fileId);
    } catch {
      /* Retain database-backed cleanup after failed or uncertain writes. */
    }
    throw error;
  }
}

/** Authorization is part of the same read that selects Track data. */
async function accessibleTrack({
  db,
  token,
  id,
}: TrackDependencies & { id: string }) {
  if (!trackIdPattern.test(id)) return null;
  const [track] = await db
    .select({
      id: tracks.id,
      name: tracks.name,
      description: tracks.description,
      activity: tracks.activity,
      difficulty: tracks.difficulty,
      visibility: tracks.visibility,
      createdAt: tracks.createdAt,
      distanceMeters: tracks.distanceMeters,
      pointCount: tracks.pointCount,
      durationSeconds: tracks.durationSeconds,
      ascentMeters: tracks.ascentMeters,
      descentMeters: tracks.descentMeters,
      minElevationMeters: tracks.minElevationMeters,
      maxElevationMeters: tracks.maxElevationMeters,
      elevationSampleCount: tracks.elevationSampleCount,
      ownerName: sql<string>`coalesce(nullif(btrim(${users.displayName}),''),${users.firstName} || ' ' || left(${users.lastName},1) || '.')`,
      ownerId: tracks.ownerId,
      originalFileId: tracks.originalFileId,
      storageLocation: storedFiles.storageLocation,
      objectKey: storedFiles.objectKey,
      byteSize: storedFiles.byteSize,
      sha256: storedFiles.sha256,
    })
    .from(tracks)
    .innerJoin(users, eq(users.id, tracks.ownerId))
    .leftJoin(
      sessions,
      and(
        eq(sessions.userId, users.id),
        eq(sessions.tokenHash, isSessionToken(token) ? digest(token) : ""),
        gt(sessions.expiresAt, sql`clock_timestamp()`),
      ),
    )
    .innerJoin(
      storedFiles,
      and(
        eq(storedFiles.id, tracks.originalFileId),
        eq(storedFiles.ownerId, tracks.ownerId),
        eq(storedFiles.purpose, "gpx"),
        eq(storedFiles.status, "ready"),
      ),
    )
    .where(
      and(
        eq(tracks.id, id),
        eq(users.active, true),
        or(eq(tracks.visibility, "public"), sql`${sessions.id} IS NOT NULL`),
      ),
    )
    .limit(1);
  return track ?? null;
}
export async function getTrack(
  dependencies: TrackDependencies & { id: string },
) {
  const track = await accessibleTrack(dependencies);
  if (!track) return null;
  const tags = await dependencies.db
    .select({ label: trackTags.label })
    .from(trackTags)
    .where(eq(trackTags.trackId, track.id))
    .orderBy(trackTags.ordinal);
  return {
    id: track.id,
    name: track.name,
    description: track.description,
    activity: track.activity,
    difficulty: track.difficulty,
    visibility: track.visibility,
    createdAt: track.createdAt,
    distanceMeters: track.distanceMeters,
    pointCount: track.pointCount,
    durationSeconds: track.durationSeconds,
    ascentMeters: track.ascentMeters,
    descentMeters: track.descentMeters,
    minElevationMeters: track.minElevationMeters,
    maxElevationMeters: track.maxElevationMeters,
    elevationSampleCount: track.elevationSampleCount,
    ownerName: track.ownerName,
    tags: tags.map((tag) => tag.label),
  };
}
export async function downloadTrack(
  dependencies: TrackDependencies & { store: ObjectStore; id: string },
) {
  const track = await accessibleTrack(dependencies);
  if (!track) throw new TrackError("notFound");
  if (track.storageLocation !== dependencies.store.location)
    throw new TrackError("unavailable");
  const bytes = await dependencies.store.get(track.objectKey, track.byteSize);
  if (
    !bytes ||
    bytes.length !== track.byteSize ||
    digest(bytes) !== track.sha256
  )
    throw new TrackError("unavailable");
  return { bytes };
}
/** Track authority never permits reading an avatar original or caller-selected file. */
export async function downloadTrackAvatar(
  dependencies: TrackDependencies & { store: ObjectStore; id: string },
) {
  const track = await accessibleTrack(dependencies);
  if (!track) throw new TrackError("notFound");
  const [file] = await dependencies.db
    .select({
      id: storedFiles.id,
      storageLocation: storedFiles.storageLocation,
      byteSize: storedFiles.avatar128Bytes,
      sha256: storedFiles.avatar128Sha256,
    })
    .from(users)
    .innerJoin(
      storedFiles,
      and(
        eq(storedFiles.id, users.avatarFileId),
        eq(storedFiles.ownerId, users.id),
        eq(storedFiles.purpose, "avatar"),
        eq(storedFiles.status, "ready"),
      ),
    )
    .where(and(eq(users.id, track.ownerId), eq(users.active, true)));
  if (!file?.byteSize || !file.sha256) throw new TrackError("notFound");
  if (file.storageLocation !== dependencies.store.location)
    throw new TrackError("unavailable");
  const bytes = await dependencies.store.get(
    avatarVersionKey(file.id, 128),
    file.byteSize,
  );
  if (!bytes || bytes.length !== file.byteSize || digest(bytes) !== file.sha256)
    throw new TrackError("unavailable");
  // Do not return a removed/replaced image after a slow storage read.
  const [current] = await dependencies.db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, track.ownerId),
        eq(users.active, true),
        eq(users.avatarFileId, file.id),
      ),
    );
  if (!current || !(await accessibleTrack(dependencies)))
    throw new TrackError("notFound");
  return { bytes };
}
export async function getTrackSamples(
  dependencies: TrackDependencies & { id: string },
) {
  const track = await accessibleTrack(dependencies);
  if (!track) return null;
  const [data] = await dependencies.db
    .select({ samples: trackData.samples })
    .from(trackData)
    .where(eq(trackData.trackId, track.id));
  return data?.samples ?? null;
}
export async function getTrackData(
  dependencies: TrackDependencies & { id: string },
) {
  const track = await accessibleTrack(dependencies);
  if (!track) return null;
  const [data] = await dependencies.db
    .select({
      geometry: sql<{
        type: "LineString";
        coordinates: [number, number][];
      }>`ST_AsGeoJSON(${trackData.geometry},17)::jsonb`,
      samples: trackData.samples,
    })
    .from(trackData)
    .where(eq(trackData.trackId, track.id));
  return data ?? null;
}

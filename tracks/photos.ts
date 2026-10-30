import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { storedFiles, trackPhotos } from "../db/schema";
import { TrackError, trackIdPattern } from "./validation";
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type PhotoInput = { id: string; caption: string };
export function validatePhotos(input: unknown): PhotoInput[] {
  if (!Array.isArray(input) || input.length > 20)
    throw new TrackError("invalidRequest");
  const ids = new Set<string>();
  return input.map((v) => {
    if (
      !v ||
      typeof v !== "object" ||
      Object.keys(v).some((k) => !["id", "caption"].includes(k)) ||
      typeof v.id !== "string" ||
      !trackIdPattern.test(v.id) ||
      ids.has(v.id) ||
      typeof v.caption !== "string" ||
      [...v.caption].length > 500 ||
      v.caption.includes("\0")
    )
      throw new TrackError("invalidRequest");
    ids.add(v.id);
    return { id: v.id, caption: v.caption };
  });
}
export async function savePhotos(
  tx: Transaction,
  ownerId: string,
  trackId: string,
  input: PhotoInput[],
) {
  const existing = await tx
    .select()
    .from(trackPhotos)
    .where(eq(trackPhotos.trackId, trackId));
  for (const photo of input) {
    const [file] = await tx
      .select({ id: storedFiles.id, trackId: trackPhotos.trackId })
      .from(storedFiles)
      .innerJoin(trackPhotos, eq(trackPhotos.id, storedFiles.id))
      .where(
        and(
          eq(storedFiles.id, photo.id),
          eq(storedFiles.ownerId, ownerId),
          eq(storedFiles.purpose, "photo"),
          eq(storedFiles.status, "ready"),
          sql`(${trackPhotos.trackId} = ${trackId} OR (${trackPhotos.trackId} IS NULL AND ${storedFiles.expiresAt}>clock_timestamp()))`,
        ),
      )
      .for("update");
    if (!file) throw new TrackError("notFound");
  }
  const removed = existing
    .filter((v) => !input.some((p) => p.id === v.id))
    .map((v) => v.id);
  if (removed.length) {
    await tx
      .update(storedFiles)
      .set({
        status: "deleting",
        deleteAfter: sql`clock_timestamp()+interval '24 hours'`,
      })
      .where(inArray(storedFiles.id, removed));
    await tx
      .update(trackPhotos)
      .set({ trackId: null })
      .where(inArray(trackPhotos.id, removed));
  }
  for (const [ordinal, photo] of input.entries())
    await tx
      .update(trackPhotos)
      .set({ trackId, ordinal, caption: photo.caption })
      .where(eq(trackPhotos.id, photo.id));
}
export async function withdrawTrackPhotos(tx: Transaction, trackId: string) {
  const photos = await tx
    .select()
    .from(trackPhotos)
    .where(eq(trackPhotos.trackId, trackId));
  if (photos.length) {
    await tx
      .update(storedFiles)
      .set({
        status: "deleting",
        deleteAfter: sql`clock_timestamp()+interval '24 hours'`,
      })
      .where(
        inArray(
          storedFiles.id,
          photos.map((p) => p.id),
        ),
      );
    await tx
      .update(trackPhotos)
      .set({ trackId: null })
      .where(eq(trackPhotos.trackId, trackId));
  }
}

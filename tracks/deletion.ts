import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { deletedTrackUploads, storedFiles, tracks } from "../db/schema";
import { withdrawTrackPhotos } from "./photos";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type LockedTrack = Pick<
  typeof tracks.$inferSelect,
  "id" | "ownerId" | "requestId" | "originalFileId"
>;

/**
 * Internal lifecycle shared by owner and Administrator deletion. The caller
 * authorizes and locks the account/session and Track in its own transaction,
 * and handles missing targets/retries. Physical removal belongs to file cleanup.
 */
export async function deleteLockedTrack(tx: Transaction, track: LockedTrack) {
  await tx.insert(deletedTrackUploads).values({
    ownerId: track.ownerId,
    requestId: track.requestId,
    trackId: track.id,
  });
  await withdrawTrackPhotos(tx, track.id);
  await tx.delete(tracks).where(eq(tracks.id, track.id));
  await tx
    .update(storedFiles)
    .set({ status: "deleting", deleteAfter: sql`clock_timestamp()` })
    .where(
      and(
        eq(storedFiles.id, track.originalFileId),
        eq(storedFiles.ownerId, track.ownerId),
      ),
    );
}

import "server-only";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "../auth/database";
import {
  deletedTrackUploads,
  storedFiles,
  tracks,
  trackUploadAttempts,
} from "../db/schema";
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
export async function deleteLockedTrack(
  tx: Transaction,
  track: LockedTrack,
  notBefore: SQL = sql`clock_timestamp()`,
) {
  await tx.insert(deletedTrackUploads).values({
    ownerId: track.ownerId,
    requestId: track.requestId,
    trackId: track.id,
  });
  // Retain only attempt/output identities after any sibling is deleted. The
  // complete ordered identity list still protects surviving publication records.
  await tx
    .update(trackUploadAttempts)
    .set({
      state: "deleted",
      fingerprint: "0".repeat(64),
      fileId: null,
      trackId: null,
    })
    .where(
      and(
        eq(trackUploadAttempts.ownerId, track.ownerId),
        eq(trackUploadAttempts.requestId, track.requestId),
      ),
    );
  await withdrawTrackPhotos(tx, track.id);
  await tx.delete(tracks).where(eq(tracks.id, track.id));
  await tx
    .update(storedFiles)
    .set({
      status: "deleting",
      deleteAfter: sql`greatest(${storedFiles.deleteAfter}, ${notBefore})`,
    })
    .where(
      and(
        eq(storedFiles.id, track.originalFileId),
        eq(storedFiles.ownerId, track.ownerId),
      ),
    );
}

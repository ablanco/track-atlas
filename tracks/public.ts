import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { tracks, users, storedFiles } from "../db/schema";
import { trackIdPattern } from "./validation";

/** A deliberately session-free authority shared by metadata, headers and discovery.
 * The photo subquery observes gallery order in the same statement as access. */
function publicTracks(db: Database) {
  return db
    .select({
      id: tracks.id,
      name: tracks.name,
      description: tracks.description,
      photoId: sql<
        string | null
      >`(select p.id from track_photos p join stored_files f on f.id=p.id where p.track_id=${tracks.id} and f.status='ready' order by p.ordinal limit 1)`.as(
        "photo_id",
      ),
    })
    .from(tracks)
    .innerJoin(users, eq(users.id, tracks.ownerId))
    .innerJoin(
      storedFiles,
      and(
        eq(storedFiles.id, tracks.originalFileId),
        eq(storedFiles.ownerId, tracks.ownerId),
        eq(storedFiles.purpose, "gpx"),
        eq(storedFiles.status, "ready"),
      ),
    )
    .where(and(eq(tracks.visibility, "public"), eq(users.active, true)));
}
export async function getPublicTrack(db: Database, id: string) {
  if (!trackIdPattern.test(id)) return null;
  const query = publicTracks(db).as("public_tracks");
  const [track] = await db
    .select()
    .from(query)
    .where(eq(query.id, id))
    .limit(1);
  return track ?? null;
}
export async function listPublicTracks(db: Database) {
  const query = publicTracks(db).as("public_tracks");
  return db.select({ id: query.id }).from(query).orderBy(query.id);
}
export function trackPreview(track: { id: string; photoId: string | null }) {
  return track.photoId
    ? `/api/tracks/${track.id}/photos/${track.photoId}?size=large&format=jpeg`
    : "/images/track-atlas-preview.jpg";
}

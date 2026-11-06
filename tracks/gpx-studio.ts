import type { SupportedLocale } from "../i18n/locales";
import { currentLegalAcceptance } from "../legal/authorization";
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { isSessionToken } from "../auth/session-store";
import type { ObjectStore } from "../storage/objects";
import { TrackError, trackIdPattern } from "./validation";

type StudioTrack = {
  sessionId: string;
  tokenHash: string;
  expires: string;
  objectKey: string;
  storageLocation: string;
  byteSize: number;
  sha256: string;
};
type Dependencies = { db: Pick<Database, "execute">; id: string };

// Recheck the same current-session/public-or-owner access as GPX download.
// All times come from PostgreSQL; exports never extend the session lifetime.
async function studioTrack(
  { db, id }: Dependencies,
  session: { tokenHash: string } | { id: string },
  expires?: string,
) {
  if (!trackIdPattern.test(id)) throw new TrackError("notFound");
  const result = await db.execute<StudioTrack>(sql`
    SELECT s.id AS "sessionId", s.token_hash AS "tokenHash",
      floor(extract(epoch FROM least(s.expires_at, clock_timestamp() + interval '10 minutes')))::text AS expires,
      f.object_key AS "objectKey", f.storage_location AS "storageLocation",
      f.byte_size AS "byteSize", f.sha256
    FROM sessions s JOIN users viewer ON viewer.id=s.user_id AND viewer.active
    JOIN tracks t ON t.id=${id}::uuid
    JOIN users owner ON owner.id=t.owner_id AND owner.active
    JOIN stored_files f ON f.id=t.original_file_id AND f.owner_id=t.owner_id
      AND f.purpose='gpx' AND f.status='ready'
    WHERE ${"tokenHash" in session ? sql`s.token_hash=${session.tokenHash}` : sql`s.id=${session.id}::uuid`}
      AND s.expires_at>clock_timestamp()
      AND ${currentLegalAcceptance(sql`viewer.id`)}
      AND (t.visibility='public' OR t.owner_id=viewer.id)
      ${expires ? sql`AND to_timestamp(${expires}::double precision)>clock_timestamp()` : sql``}
  `);
  const track = result.rows[0];
  if (!track) throw new TrackError("notFound");
  return track;
}

function signature(track: StudioTrack, id: string, expires: string) {
  // Purpose-separated HMAC: the high-entropy session digest stays server-side.
  // The resulting capability cannot authenticate a session or access another track.
  return createHmac("sha256", Buffer.from(track.tokenHash, "hex"))
    .update(`track-atlas:gpx-studio:v1:${track.sessionId}:${id}:${expires}`)
    .digest();
}

export async function createGpxStudioUrl(
  dependencies: Dependencies & {
    token: string | undefined;
    origin: string;
    locale: SupportedLocale;
  },
) {
  if (!isSessionToken(dependencies.token)) throw new TrackError("unauthorized");
  const track = await studioTrack(dependencies, {
    tokenHash: createHash("sha256").update(dependencies.token).digest("hex"),
  });
  const key = [
    track.sessionId,
    track.expires,
    signature(track, dependencies.id, track.expires).toString("base64url"),
  ].join(".");
  const file = new URL(
    `/api/tracks/${dependencies.id}/gpx-studio/${key}/track.gpx`,
    dependencies.origin,
  );
  const editor = new URL(`https://gpx.studio/${dependencies.locale}/app`);
  editor.searchParams.set("files", JSON.stringify([file.href]));
  return editor.href;
}

export async function readGpxStudioFile(
  dependencies: Dependencies & { key: string; store: ObjectStore },
) {
  const parts = dependencies.key.split(".");
  if (
    parts.length !== 3 ||
    !trackIdPattern.test(parts[0]) ||
    !/^\d{10}$/.test(parts[1]) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[2])
  )
    throw new TrackError("notFound");
  const [sessionId, expires, mac] = parts;
  const track = await studioTrack(dependencies, { id: sessionId }, expires);
  if (
    !timingSafeEqual(
      signature(track, dependencies.id, expires),
      Buffer.from(mac, "base64url"),
    )
  )
    throw new TrackError("notFound");
  if (track.storageLocation !== dependencies.store.location)
    throw new TrackError("unavailable");
  const bytes = await dependencies.store.get(track.objectKey, track.byteSize);
  if (
    !bytes ||
    bytes.length !== track.byteSize ||
    createHash("sha256").update(bytes).digest("hex") !== track.sha256
  )
    throw new TrackError("unavailable");
  return bytes;
}

import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database, AuthTransaction } from "../auth/database";
import { findSessionUser, isSessionToken } from "../auth/session-store";
import type {
  TrackListSummary,
  TrackListIndex,
  TrackListPicker,
} from "./list-types";
import { TrackListError, listName } from "./list-validation";
import { trackIdPattern } from "./validation";
type Dependencies = {
  db: Omit<Database, "$client">;
  token: string | undefined;
};
export const listSessionHash = (token: string | undefined) =>
  isSessionToken(token) ? createHash("sha256").update(token).digest("hex") : "";
export const listViewer = (token: string | undefined) =>
  sql`SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.active AND s.token_hash=${listSessionHash(token)} AND s.expires_at>statement_timestamp()`;
// Always lock our account, then session, then list. Match account/track mutation
// ordering; never lock a foreign uploader account while holding our own lock.
async function asOwner<T>(
  { db, token }: Dependencies,
  work: (tx: AuthTransaction, id: string) => Promise<T>,
): Promise<T> {
  const user = await findSessionUser(db, token);
  if (!user) throw new TrackListError("unauthorized");
  return db.transaction(async (tx) => {
    const owner = await tx.execute(
      sql`SELECT id FROM users WHERE id=${user.userId}::uuid AND active FOR UPDATE`,
    );
    if (!owner.rows.length) throw new TrackListError("unauthorized");
    const session = await tx.execute(
      sql`SELECT id FROM sessions WHERE user_id=${user.userId}::uuid AND token_hash=${listSessionHash(token)} FOR UPDATE`,
    );
    if (!session.rows.length) throw new TrackListError("unauthorized");
    // A lock wait can outlast expiry without changing the locked row; evaluate
    // the database clock in a fresh statement after the lock has been acquired.
    const current = await tx.execute(
      sql`SELECT 1 FROM sessions WHERE user_id=${user.userId}::uuid AND token_hash=${listSessionHash(token)} AND expires_at>clock_timestamp()`,
    );
    if (!current.rows.length) throw new TrackListError("unauthorized");
    const result = await work(tx, user.userId);
    // A later list/track lock can also wait past expiry. Reject before commit so
    // any changes made after that wait are rolled back with the transaction.
    const finalSession = await tx.execute(
      sql`SELECT 1 FROM sessions WHERE user_id=${user.userId}::uuid AND token_hash=${listSessionHash(token)} AND expires_at>clock_timestamp()`,
    );
    if (!finalSession.rows.length) throw new TrackListError("unauthorized");
    return result;
  });
}
export async function getTrackList({
  db,
  token,
  id,
}: Dependencies & { id: string }): Promise<TrackListSummary | null> {
  if (!trackIdPattern.test(id)) throw new TrackListError("invalidRequest");
  const result = await db.execute<{
    viewer: string | null;
    list: TrackListSummary | null;
  }>(sql`
 WITH viewer AS (${listViewer(token)}) SELECT (SELECT id FROM viewer) AS viewer,
 (SELECT ${summary} FROM track_lists l WHERE l.id=${id}::uuid AND l.owner_id=(SELECT id FROM viewer)) AS list`);
  if (!result.rows[0].viewer) throw new TrackListError("unauthorized");
  return result.rows[0].list;
}
export async function createTrackList(
  deps: Dependencies & { input: unknown },
): Promise<TrackListSummary> {
  const { name, normalizedName } = listName(deps.input);
  const input = deps.input as Record<string, unknown>;
  if (
    Object.keys(input).some((k) => !["name", "trackId"].includes(k)) ||
    ("trackId" in input &&
      (typeof input.trackId !== "string" ||
        !trackIdPattern.test(input.trackId)))
  )
    throw new TrackListError("invalidRequest");
  return asOwner(deps, async (tx, ownerId) => {
    if (
      (
        await tx.execute(
          sql`SELECT 1 FROM track_lists WHERE owner_id=${ownerId}::uuid AND normalized_name=${normalizedName}`,
        )
      ).rows.length
    )
      throw new TrackListError("duplicateName");
    if (
      (
        await tx.execute<{ count: number }>(
          sql`SELECT count(*)::int AS count FROM track_lists WHERE owner_id=${ownerId}::uuid`,
        )
      ).rows[0].count >= 100
    )
      throw new TrackListError("listLimit");
    const row = await tx.execute<{ id: string }>(
      sql`INSERT INTO track_lists(owner_id,name,normalized_name) VALUES(${ownerId}::uuid,${name},${normalizedName}) RETURNING id`,
    );
    if (typeof input.trackId === "string")
      await addMembership(tx, ownerId, row.rows[0].id, input.trackId);
    return (await getTrackList({
      db: tx,
      token: deps.token,
      id: row.rows[0].id,
    }))!;
  });
}

async function requireList(tx: AuthTransaction, ownerId: string, id: string) {
  if (!trackIdPattern.test(id)) throw new TrackListError("invalidRequest");
  if (
    !(
      await tx.execute(
        sql`SELECT id FROM track_lists WHERE id=${id}::uuid AND owner_id=${ownerId}::uuid FOR UPDATE`,
      )
    ).rows.length
  )
    throw new TrackListError("notFound");
}
async function addMembership(
  tx: AuthTransaction,
  ownerId: string,
  id: string,
  trackId: string,
) {
  // Snapshot reauthorizes both uploader status and track access, even on retries.
  const visible = await tx.execute(
    sql`SELECT t.id FROM tracks t JOIN users u ON u.id=t.owner_id AND u.active JOIN stored_files f ON f.id=t.original_file_id AND f.owner_id=t.owner_id AND f.status='ready' AND f.purpose='gpx' WHERE t.id=${trackId}::uuid AND (t.visibility='public' OR t.owner_id=${ownerId}::uuid)`,
  );
  if (!visible.rows.length) throw new TrackListError("notFound");
  if (
    (
      await tx.execute(
        sql`SELECT 1 FROM track_list_memberships WHERE list_id=${id}::uuid AND track_id=${trackId}::uuid`,
      )
    ).rows.length
  )
    return;
  const count = await tx.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM track_list_memberships WHERE list_id=${id}::uuid`,
  );
  if (count.rows[0].count >= 1000) throw new TrackListError("trackLimit");
  await tx.execute(
    sql`INSERT INTO track_list_memberships(list_id,track_id) VALUES(${id}::uuid,${trackId}::uuid) ON CONFLICT DO NOTHING`,
  );
}
export async function setTrackListMembership(
  deps: Dependencies & { id: string; trackId: string; present: boolean },
): Promise<void> {
  if (!trackIdPattern.test(deps.trackId))
    throw new TrackListError("invalidRequest");
  return asOwner(deps, async (tx, ownerId) => {
    await requireList(tx, ownerId, deps.id);
    if (deps.present) await addMembership(tx, ownerId, deps.id, deps.trackId);
    else
      await tx.execute(
        sql`DELETE FROM track_list_memberships WHERE list_id=${deps.id}::uuid AND track_id=${deps.trackId}::uuid`,
      );
  });
}
const summary = sql`jsonb_build_object('id',l.id,'name',l.name,'createdAt',l.created_at,'trackCount',(
 SELECT count(*)::int FROM track_list_memberships m JOIN tracks t ON t.id=m.track_id JOIN users u ON u.id=t.owner_id AND u.active JOIN stored_files f ON f.id=t.original_file_id AND f.owner_id=t.owner_id AND f.purpose='gpx' AND f.status='ready'
 WHERE m.list_id=l.id AND (t.visibility='public' OR t.owner_id=l.owner_id)))`;
export async function getTrackListPicker({
  db,
  token,
  trackId,
}: Dependencies & { trackId: string }): Promise<TrackListPicker> {
  if (!trackIdPattern.test(trackId)) throw new TrackListError("invalidRequest");
  const result = await db.execute<{
    viewer: string | null;
    accessible: boolean;
    lists: TrackListPicker["lists"];
  }>(sql`
 WITH viewer AS (${listViewer(token)}) SELECT (SELECT id FROM viewer) AS viewer,
 EXISTS(SELECT 1 FROM tracks t JOIN users u ON u.id=t.owner_id AND u.active JOIN stored_files f ON f.id=t.original_file_id AND f.owner_id=t.owner_id AND f.purpose='gpx' AND f.status='ready' WHERE t.id=${trackId}::uuid AND (t.visibility='public' OR t.owner_id=(SELECT id FROM viewer))) AS accessible,
 coalesce((SELECT jsonb_agg(${summary} || jsonb_build_object('containsTrack',EXISTS(SELECT 1 FROM track_list_memberships m WHERE m.list_id=l.id AND m.track_id=${trackId}::uuid)) ORDER BY l.created_at DESC,l.id DESC) FROM track_lists l WHERE l.owner_id=(SELECT id FROM viewer)),'[]'::jsonb) AS lists`);
  const row = result.rows[0];
  if (!row.viewer) throw new TrackListError("unauthorized");
  if (!row.accessible) throw new TrackListError("notFound");
  return { lists: row.lists };
}
export async function getTrackLists({
  db,
  token,
  page = 1,
}: Dependencies & { page?: number }): Promise<TrackListIndex> {
  if (!Number.isSafeInteger(page) || page < 1)
    throw new TrackListError("invalidRequest");
  const result = await db.execute<{
    viewer: string | null;
    result: TrackListIndex;
  }>(sql`
 WITH viewer AS (${listViewer(token)}), totals AS (SELECT count(*)::int AS total,greatest(1,ceil(count(*)/20.0)::int) AS pages FROM track_lists WHERE owner_id=(SELECT id FROM viewer)),
 paging AS (SELECT total,pages,least(${page},pages) AS page FROM totals), page_lists AS (SELECT l.* FROM track_lists l WHERE l.owner_id=(SELECT id FROM viewer) ORDER BY l.created_at DESC,l.id DESC LIMIT 20 OFFSET (SELECT (page-1)*20 FROM paging))
 SELECT (SELECT id FROM viewer) AS viewer,jsonb_build_object('lists',coalesce((SELECT jsonb_agg(${summary} ORDER BY l.created_at DESC,l.id DESC) FROM page_lists l),'[]'::jsonb),'total',total,'page',page,'pageCount',pages) AS result FROM paging`);
  if (!result.rows[0].viewer) throw new TrackListError("unauthorized");
  return result.rows[0].result;
}
export async function renameTrackList(
  deps: Dependencies & { id: string; input: unknown },
): Promise<TrackListSummary> {
  const { name, normalizedName } = listName(deps.input);
  if (Object.keys(deps.input as object).some((k) => k !== "name"))
    throw new TrackListError("invalidRequest");
  return asOwner(deps, async (tx, ownerId) => {
    await requireList(tx, ownerId, deps.id);
    if (
      (
        await tx.execute(
          sql`SELECT 1 FROM track_lists WHERE owner_id=${ownerId}::uuid AND normalized_name=${normalizedName} AND id<>${deps.id}::uuid`,
        )
      ).rows.length
    )
      throw new TrackListError("duplicateName");
    await tx.execute(
      sql`UPDATE track_lists SET name=${name},normalized_name=${normalizedName} WHERE id=${deps.id}::uuid`,
    );
    return (await getTrackList({ db: tx, token: deps.token, id: deps.id }))!;
  });
}
export async function deleteTrackList(
  deps: Dependencies & { id: string },
): Promise<void> {
  return asOwner(deps, async (tx, ownerId) => {
    await requireList(tx, ownerId, deps.id);
    await tx.execute(sql`DELETE FROM track_lists WHERE id=${deps.id}::uuid`);
  });
}

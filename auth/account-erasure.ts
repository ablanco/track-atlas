import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Database } from "./database";
import { tracks } from "../db/schema";
import type { ObjectStore } from "../storage/objects";
import { cleanupFiles } from "../storage/files";
import { deleteLockedTrack } from "../tracks/deletion";

export const accountIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export class AccountErasureError extends Error {
  constructor(readonly code: "invalidConfirmation" | "notFound" | "lastAdmin") {
    super(code);
  }
}
type Scope = {
  erasureStartedAt: string | null;
  lastActiveAdmin: boolean;
  files: number;
  tracks: number;
  lists: number;
  votes: number;
  comments: number;
  replies: number;
  acceptances: number;
  sessions: number;
  tokens: number;
  locations: string[];
  nextCleanupAt: string | null;
};
async function scope(db: Pick<Database, "execute">, userId: string) {
  return (
    await db.execute<Scope>(sql`SELECT
    u.erasure_started_at::text AS "erasureStartedAt",
    (u.active AND u.admin AND NOT EXISTS (SELECT 1 FROM users WHERE active AND admin AND id<>u.id)) AS "lastActiveAdmin",
    (SELECT count(*)::int FROM stored_files WHERE owner_id=u.id) AS files,
    (SELECT count(*)::int FROM tracks WHERE owner_id=u.id) AS tracks,
    (SELECT count(*)::int FROM track_lists WHERE owner_id=u.id) AS lists,
    (SELECT count(*)::int FROM track_votes WHERE voter_id=u.id) AS votes,
    (SELECT count(*)::int FROM track_comments WHERE author_id=u.id) AS comments,
    (SELECT count(*)::int FROM track_comment_replies WHERE author_id=u.id) AS replies,
    (SELECT count(*)::int FROM legal_acceptances WHERE user_id=u.id) AS acceptances,
    (SELECT count(*)::int FROM sessions WHERE user_id=u.id) AS sessions,
    (SELECT count(*)::int FROM account_action_tokens WHERE user_id=u.id) AS tokens,
    ARRAY(SELECT DISTINCT storage_location FROM stored_files WHERE owner_id=u.id ORDER BY storage_location) AS locations,
    (SELECT max(delete_after)::text FROM stored_files WHERE owner_id=u.id) AS "nextCleanupAt"
    FROM users u WHERE id=${userId}::uuid`)
  ).rows[0];
}
/** Staff-only server service. No public action/HTTP adapter. Storage adapters must identify their exact persisted location. */
export async function eraseAccount({
  db,
  userId,
  confirmation,
  dryRun = false,
  stores,
}: {
  db: Database;
  userId: string;
  confirmation?: string;
  dryRun?: boolean;
  stores: ObjectStore[];
}) {
  if (!accountIdPattern.test(userId) || (!dryRun && confirmation !== userId))
    throw new AccountErasureError("invalidConfirmation");
  const before = await scope(db, userId);
  if (!before) throw new AccountErasureError("notFound");
  if (dryRun) return { status: "dry-run" as const, ...before };
  // Same lock/order as administration: privilege lock, account, then content.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(241022)`);
    const user = (
      await tx.execute<{
        active: boolean;
        admin: boolean;
        erasure_started_at: Date | null;
      }>(
        sql`SELECT active,admin,erasure_started_at FROM users WHERE id=${userId}::uuid FOR UPDATE`,
      )
    ).rows[0];
    if (!user) return; // Another invocation completed while we waited.
    if (user.erasure_started_at) return;
    if (user.active && user.admin) {
      const others = await tx.execute(
        sql`SELECT id FROM users WHERE active AND admin AND id<>${userId}::uuid`,
      );
      if (!others.rows.length) throw new AccountErasureError("lastAdmin");
    }
    await tx.execute(
      sql`UPDATE users SET active=false,avatar_file_id=NULL,erasure_started_at=clock_timestamp() WHERE id=${userId}::uuid`,
    );
    // Includes old avatars, unfinished reservations and unattached photos. Do not
    // shorten an existing tombstone or refresh it on every resume.
    await tx.execute(
      sql`UPDATE stored_files SET status='deleting',delete_after=greatest(coalesce(delete_after,'-infinity'::timestamptz),(SELECT erasure_started_at FROM users WHERE id=${userId}::uuid)+interval '24 hours') WHERE owner_id=${userId}::uuid AND status IN ('pending','deleting')`,
    );
    await tx.execute(sql`DELETE FROM sessions WHERE user_id=${userId}::uuid`);
    await tx.execute(
      sql`DELETE FROM account_action_tokens WHERE user_id=${userId}::uuid`,
    );
  });
  // Withdrawal is committed independently: failures below cannot restore access.
  await db.transaction(async (tx) => {
    const user = await tx.execute(
      sql`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`,
    );
    if (!user.rows.length) return;
    await tx.execute(sql`SELECT id FROM tracks WHERE owner_id=${userId}::uuid
      OR id IN (SELECT track_id FROM track_votes WHERE voter_id=${userId}::uuid)
      OR id IN (SELECT track_id FROM track_comments WHERE author_id=${userId}::uuid)
      OR id IN (SELECT c.track_id FROM track_comments c JOIN track_comment_replies r ON r.comment_id=c.id WHERE r.author_id=${userId}::uuid)
      ORDER BY id FOR UPDATE`);
    const owned = await tx
      .select()
      .from(tracks)
      .where(eq(tracks.ownerId, userId))
      .orderBy(tracks.id)
      .for("update");
    for (const track of owned)
      await deleteLockedTrack(
        tx,
        track,
        sql`(SELECT erasure_started_at FROM users WHERE id=${userId}::uuid)+interval '24 hours'`,
      );
    await tx.execute(
      sql`DELETE FROM track_comment_replies WHERE author_id=${userId}::uuid`,
    );
    await tx.execute(
      sql`DELETE FROM track_comments WHERE author_id=${userId}::uuid`,
    );
    await tx.execute(
      sql`DELETE FROM track_lists WHERE owner_id=${userId}::uuid`,
    );
    // The existing vote-deletion trigger updates surviving popularity under
    // the sorted track locks acquired above.
    await tx.execute(
      sql`DELETE FROM track_votes WHERE voter_id=${userId}::uuid`,
    );
    await tx.execute(
      sql`UPDATE stored_files SET status='deleting',delete_after=(SELECT erasure_started_at FROM users WHERE id=${userId}::uuid)+interval '24 hours' WHERE owner_id=${userId}::uuid AND status<>'deleting'`,
    );
  });
  let failed = 0;
  for (const store of new Map(
    stores.map((store) => [store.location, store]),
  ).values()) {
    const result = await cleanupFiles({ db, store, ownerId: userId });
    failed += result.failed;
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM users WHERE id=${userId}::uuid FOR UPDATE`,
    );
    const remaining = await scope(tx, userId);
    if (!remaining) return { status: "complete" as const, files: 0 };
    if (remaining.files)
      return {
        status: failed ? ("failed" as const) : ("pending" as const),
        ...remaining,
        failed,
        unconfiguredLocations: remaining.locations.filter(
          (location) => !stores.some((s) => s.location === location),
        ),
      };
    // Evidence and all remaining account-dependent ledgers cascade only here.
    await tx.execute(
      sql`DELETE FROM users WHERE id=${userId}::uuid AND erasure_started_at IS NOT NULL`,
    );
    return { status: "complete" as const, files: 0 };
  });
}

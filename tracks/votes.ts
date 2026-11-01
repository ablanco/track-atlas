import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { isSessionToken } from "../auth/session-store";
import { TrackError, trackIdPattern } from "./validation";

export type TrackVote = "up" | "down" | null;
export type TrackVotes = {
  up: number;
  down: number;
  popularity: number;
  vote: TrackVote;
  canVote: boolean;
  needsConfirmation: boolean;
};
type Dependencies = {
  db: Omit<Database, "$client">;
  token: string | undefined;
  id: string;
};
const hash = (token: string | undefined) =>
  isSessionToken(token) ? createHash("sha256").update(token).digest("hex") : "";

/** Request-specific identity, access and aggregates share one statement snapshot. */
export async function getTrackVotes({
  db,
  token,
  id,
}: Pick<Dependencies, "token" | "id"> & {
  db: Pick<Database, "execute">;
}): Promise<TrackVotes | null> {
  if (!trackIdPattern.test(id)) return null;
  const result = await db.execute<TrackVotes>(sql`
    WITH viewer AS (
      SELECT u.id,u.email_confirmed FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE u.active AND s.token_hash=${hash(token)} AND s.expires_at>statement_timestamp()
    ) SELECT t.popularity,
      (SELECT count(*)::int FROM track_votes WHERE track_id=t.id AND direction=1) AS up,
      (SELECT count(*)::int FROM track_votes WHERE track_id=t.id AND direction=-1) AS down,
      (SELECT CASE v.direction WHEN 1 THEN 'up' ELSE 'down' END FROM track_votes v WHERE v.track_id=t.id AND v.voter_id=(SELECT id FROM viewer)) AS vote,
      coalesce(t.visibility='public' AND t.owner_id<>(SELECT id FROM viewer) AND (SELECT email_confirmed FROM viewer),false) AS "canVote",
      coalesce(t.visibility='public' AND t.owner_id<>(SELECT id FROM viewer) AND NOT (SELECT email_confirmed FROM viewer),false) AS "needsConfirmation"
    FROM tracks t JOIN users owner ON owner.id=t.owner_id AND owner.active
    JOIN stored_files f ON f.id=t.original_file_id AND f.owner_id=t.owner_id AND f.purpose='gpx' AND f.status='ready'
    WHERE t.id=${id}::uuid AND (t.visibility='public' OR t.owner_id=(SELECT id FROM viewer))
  `);
  return result.rows[0] ?? null;
}

/** Explicit desired state makes transport retries idempotent. */
export async function setTrackVote({
  db,
  token,
  id,
  input,
}: Dependencies & { input: unknown }): Promise<TrackVotes> {
  if (!isSessionToken(token)) throw new TrackError("unauthorized");
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !("vote" in input) ||
    (input.vote !== null && input.vote !== "up" && input.vote !== "down")
  )
    throw new TrackError("invalidRequest");
  if (!trackIdPattern.test(id)) throw new TrackError("notFound");
  const desired = input.vote;
  return db.transaction(async (tx) => {
    const identity = (
      await tx.execute<{ id: string }>(sql`
      SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE u.active AND s.token_hash=${hash(token)} AND s.expires_at>clock_timestamp()
    `)
    ).rows[0];
    if (!identity) throw new TrackError("unauthorized");
    // Lock both accounts in UUID order before the session and track, matching
    // account/owner mutations and preventing reciprocal votes from deadlocking.
    await tx.execute(
      sql`SELECT id FROM users WHERE id=${identity.id}::uuid OR id=(SELECT owner_id FROM tracks WHERE id=${id}::uuid) ORDER BY id FOR UPDATE`,
    );
    const viewer = (
      await tx.execute<{ email_confirmed: boolean }>(sql`
      SELECT u.email_confirmed FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE u.id=${identity.id}::uuid AND u.active AND s.token_hash=${hash(token)} AND s.expires_at>clock_timestamp() FOR UPDATE OF s
    `)
    ).rows[0];
    if (!viewer) throw new TrackError("unauthorized");
    await tx.execute(
      sql`SELECT id FROM tracks WHERE id=${id}::uuid FOR UPDATE`,
    );
    // Recheck after all lock waits: no stale eligibility or expired session.
    const checkSession = async () => {
      const current = await tx.execute(
        sql`SELECT id FROM sessions WHERE user_id=${identity.id}::uuid AND token_hash=${hash(token)} AND expires_at>clock_timestamp()`,
      );
      if (!current.rows.length) throw new TrackError("unauthorized");
    };
    await checkSession();
    const eligible = (
      await tx.execute<{ owner_id: string; visibility: string }>(sql`
      SELECT t.owner_id,t.visibility FROM tracks t JOIN users u ON u.id=t.owner_id AND u.active
      JOIN stored_files f ON f.id=t.original_file_id AND f.owner_id=t.owner_id AND f.purpose='gpx' AND f.status='ready'
      WHERE t.id=${id}::uuid AND (t.visibility='public' OR t.owner_id=${identity.id}::uuid)
    `)
    ).rows[0];
    if (!eligible) throw new TrackError("notFound");
    if (eligible.owner_id === identity.id || eligible.visibility !== "public")
      throw new TrackError("forbidden");
    if (!viewer.email_confirmed) throw new TrackError("emailUnconfirmed");
    if (desired === null) {
      await tx.execute(
        sql`DELETE FROM track_votes WHERE track_id=${id}::uuid AND voter_id=${identity.id}::uuid`,
      );
    } else {
      await tx.execute(sql`INSERT INTO track_votes(track_id,voter_id,direction) VALUES (${id}::uuid,${identity.id}::uuid,${desired === "up" ? 1 : -1})
        ON CONFLICT(track_id,voter_id) DO UPDATE SET direction=excluded.direction WHERE track_votes.direction<>excluded.direction`);
    }
    const result = await getTrackVotes({ db: tx, token, id });
    if (!result) throw new TrackError("notFound");
    await checkSession();
    return result;
  });
}

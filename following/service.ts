import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database, AuthTransaction } from "../auth/database";
import { isSessionToken } from "../auth/session-store";
import { currentLegalAcceptance } from "../legal/authorization";
import { trackIdPattern } from "../tracks/validation";
import type { FollowState, FollowingPage, FollowingErrorCode } from "./types";
export class FollowingError extends Error {
  constructor(readonly code: FollowingErrorCode) {
    super(code);
  }
}
export type FollowingDependencies = {
  db: Pick<Database, "execute" | "transaction">;
  token: string | undefined;
};
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function followingIdentity({
  db,
  token,
}: Pick<FollowingDependencies, "token"> & { db: Pick<Database, "execute"> }) {
  if (!isSessionToken(token)) throw new FollowingError("unauthorized");
  const row = (
    await db.execute<{ id: string }>(
      sql`SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.active AND ${currentLegalAcceptance(sql`u.id`)} AND s.token_hash=${hash(token)} AND s.expires_at>clock_timestamp()`,
    )
  ).rows[0];
  if (!row) throw new FollowingError("unauthorized");
  return row.id;
}
/** Locks all affected users in UUID order, then session; rechecks after waits and writes. */
export async function withFollowingAccount<T>(
  d: FollowingDependencies,
  ids: string[],
  work: (tx: AuthTransaction, id: string) => Promise<T>,
) {
  const id = await followingIdentity(d);
  return d.db.transaction(async (tx) => {
    const all = [...new Set([id, ...ids])].sort();
    await tx.execute(
      sql`SELECT id FROM users WHERE id IN (${sql.join(
        all.map((x) => sql`${x}::uuid`),
        sql`,`,
      )}) ORDER BY id FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM sessions WHERE user_id=${id}::uuid AND token_hash=${hash(d.token!)} FOR UPDATE`,
    );
    await followingIdentity({ ...d, db: tx });
    const result = await work(tx, id);
    await followingIdentity({ ...d, db: tx });
    return result;
  });
}
const eligible = (id: string) =>
  sql`EXISTS(SELECT 1 FROM tracks t JOIN users u ON u.id=t.owner_id AND u.active JOIN stored_files f ON f.id=t.original_file_id AND f.owner_id=u.id AND f.purpose='gpx' AND f.status='ready' WHERE t.owner_id=${id}::uuid AND t.visibility='public')`;
export async function getFollowState(
  d: FollowingDependencies & { id: string },
): Promise<FollowState> {
  const owner = await followingIdentity(d);
  if (!trackIdPattern.test(d.id)) throw new FollowingError("notFound");
  if (owner === d.id) throw new FollowingError("invalidRequest");
  const row = (
    await d.db.execute<FollowState>(
      sql`SELECT EXISTS(SELECT 1 FROM uploader_follows WHERE follower_id=${owner}::uuid AND uploader_id=${d.id}::uuid) AS following, ${eligible(d.id)} AS eligible, (SELECT email_confirmed FROM users WHERE id=${owner}::uuid) AS "emailConfirmed"`,
    )
  ).rows[0];
  await followingIdentity(d);
  if (!row.eligible && !row.following) throw new FollowingError("notFound");
  return row;
}
export async function setFollowing(
  d: FollowingDependencies & { id: string; input: unknown },
): Promise<FollowState> {
  const input = d.input;
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !("following" in input) ||
    typeof input.following !== "boolean"
  )
    throw new FollowingError("invalidRequest");
  if (!trackIdPattern.test(d.id)) throw new FollowingError("notFound");
  const desired = input.following;
  return withFollowingAccount(d, [d.id], async (tx, owner) => {
    if (owner === d.id) throw new FollowingError("invalidRequest");
    const available = (
      await tx.execute<{ value: boolean; emailConfirmed: boolean }>(
        sql`SELECT ${eligible(d.id)} AS value, (SELECT email_confirmed FROM users WHERE id=${owner}::uuid) AS "emailConfirmed"`,
      )
    ).rows[0];
    if (desired && !available.value) throw new FollowingError("notFound");
    if (desired)
      await tx.execute(
        sql`INSERT INTO uploader_follows(follower_id,uploader_id,followed_at) VALUES(${owner}::uuid,${d.id}::uuid,clock_timestamp()) ON CONFLICT DO NOTHING`,
      );
    else
      await tx.execute(
        sql`DELETE FROM uploader_follows WHERE follower_id=${owner}::uuid AND uploader_id=${d.id}::uuid`,
      );
    return {
      following: desired,
      eligible: available.value,
      emailConfirmed: available.emailConfirmed,
    };
  });
}
export async function getFollowing(
  d: FollowingDependencies & { page?: number },
): Promise<FollowingPage> {
  const id = await followingIdentity(d);
  const requested = d.page ?? 1;
  if (
    !Number.isSafeInteger(requested) ||
    requested < 1 ||
    requested > 999999999
  )
    throw new FollowingError("invalidRequest");
  // One statement gives totals and rows from the same snapshot, including empty pages.
  const result = (
    await d.db.execute<{
      total: number;
      items: FollowingPage["items"];
      emailConfirmed: boolean;
    }>(
      sql`WITH edges AS (SELECT f.*,u.active,CASE WHEN u.active THEN coalesce(nullif(btrim(u.display_name),''),u.first_name || ' ' || left(u.last_name,1) || '.') ELSE NULL END AS name,CASE WHEN u.active THEN EXISTS(SELECT 1 FROM stored_files a WHERE a.id=u.avatar_file_id AND a.owner_id=u.id AND a.status='ready' AND a.purpose='avatar' AND a.avatar_24_bytes IS NOT NULL AND a.avatar_24_sha256 IS NOT NULL) ELSE false END AS avatar FROM uploader_follows f JOIN users u ON u.id=f.uploader_id WHERE f.follower_id=${id}::uuid), counted AS (SELECT count(*)::int AS total FROM edges), paged AS (SELECT * FROM edges ORDER BY followed_at DESC,uploader_id LIMIT 25 OFFSET least(${requested}-1,greatest(0,ceil((SELECT total FROM counted)/25.0)::int-1))*25) SELECT total,(SELECT email_confirmed FROM users WHERE id=${id}::uuid) AS "emailConfirmed",coalesce((SELECT jsonb_agg(jsonb_build_object('id',uploader_id,'displayName',name,'active',active,'avatarUrl',CASE WHEN avatar THEN '/api/following/'||uploader_id||'/avatar' ELSE NULL END,'collectionUrl',CASE WHEN active THEN '/users/'||uploader_id||'/tracks' ELSE NULL END,'followedAt',to_char(followed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY followed_at DESC,uploader_id) FROM paged),'[]'::jsonb) AS items FROM counted`,
    )
  ).rows[0];
  await followingIdentity(d);
  const pages = Math.max(1, Math.ceil(result.total / 25));
  return { ...result, page: Math.min(requested, pages), pages };
}

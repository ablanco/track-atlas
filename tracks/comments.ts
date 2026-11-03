import {
  currentLegalAcceptance,
  isPendingLegalSession,
} from "../legal/authorization";
import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { isSessionToken } from "../auth/session-store";
import { trackIdPattern } from "./validation";
import type {
  CreatedDiscussionPost,
  DiscussionErrorCode,
  TrackCommentsPage,
} from "./comment-types";

export class DiscussionError extends Error {
  constructor(public readonly code: DiscussionErrorCode) {
    super(code);
  }
}
type Dependencies = {
  db: Omit<Database, "$client">;
  token: string | undefined;
  id: string;
};
const hash = (token: string | undefined) =>
  isSessionToken(token) ? createHash("sha256").update(token).digest("hex") : "";
const viewer = (
  token: string | undefined,
) => sql`SELECT u.id,u.email_confirmed FROM users u JOIN sessions s ON s.user_id=u.id
  WHERE u.active AND ${currentLegalAcceptance(sql`u.id`)} AND s.token_hash=${hash(token)} AND s.expires_at>statement_timestamp()`;
const accessible = sql`SELECT t.id,t.owner_id FROM tracks t JOIN users owner ON owner.id=t.owner_id AND owner.active
  JOIN stored_files f ON f.id=t.original_file_id AND f.owner_id=t.owner_id AND f.purpose='gpx' AND f.status='ready'
  WHERE t.visibility='public' OR t.owner_id=(SELECT id FROM viewer)`;

export function validateDiscussionText(input: unknown): string {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !("text" in input)
  )
    throw new DiscussionError("invalidRequest");
  if (typeof input.text !== "string") throw new DiscussionError("invalidText");
  const text = input.text.trim();
  if (
    !text.length ||
    [...text].length > 2000 ||
    text.includes("\0") ||
    !text.isWellFormed()
  )
    throw new DiscussionError("invalidText");
  return text;
}

/** Access, current identity and pagination share one statement snapshot. */
export async function getTrackComments({
  db,
  token,
  id,
  page = 1,
  commentId,
}: Omit<Dependencies, "db"> & {
  db: Pick<Database, "execute">;
  page?: number;
  commentId?: string;
}): Promise<TrackCommentsPage | null> {
  if (await isPendingLegalSession(db, token))
    throw new DiscussionError("unauthorized");
  if (
    !trackIdPattern.test(id) ||
    (commentId !== undefined && !trackIdPattern.test(commentId))
  )
    return null;
  if (!Number.isSafeInteger(page) || page < 1 || page > 214748364)
    throw new DiscussionError("invalidRequest");
  const result = await db.execute<{ result: TrackCommentsPage }>(sql`
    WITH viewer AS (${viewer(token)}), accessible AS (${accessible}),
    ordered AS (
      SELECT c.*,row_number() OVER (ORDER BY c.created_at,c.id) AS position
      FROM track_comments c JOIN accessible t ON t.id=c.track_id WHERE t.id=${id}::uuid
    ), target AS (
      SELECT CASE WHEN ${commentId ?? null}::uuid IS NULL THEN ${page}::int
        ELSE (SELECT ((position-1)/10+1)::int FROM ordered WHERE id=${commentId ?? null}::uuid) END AS page
    ), selected AS (
      SELECT c.* FROM ordered c,target WHERE position BETWEEN (target.page::bigint-1)*10+1 AND target.page::bigint*10
    )
    SELECT json_build_object(
      'page',target.page,'pageSize',10,'total',(SELECT count(*)::int FROM ordered),
      'pages',greatest(1,ceil((SELECT count(*) FROM ordered)/10.0)::int),
      'posting',CASE WHEN NOT EXISTS(SELECT 1 FROM viewer) THEN 'login'
        WHEN NOT (SELECT email_confirmed FROM viewer) THEN 'confirmEmail' ELSE 'allowed' END,
      'comments',coalesce((SELECT json_agg(json_build_object(
        'id',c.id,'text',c.text,'createdAt',c.created_at,
        'author',json_build_object(
          'name',CASE WHEN a.active THEN coalesce(nullif(btrim(a.display_name),''),a.first_name || ' ' || left(a.last_name,1) || '.') END,
          'deactivated',NOT a.active,'avatarUrl',CASE WHEN a.active AND EXISTS(
            SELECT 1 FROM stored_files af WHERE af.id=a.avatar_file_id AND af.owner_id=a.id AND af.purpose='avatar' AND af.status='ready' AND af.avatar_24_bytes IS NOT NULL AND af.avatar_24_sha256 IS NOT NULL
          ) THEN '/api/tracks/' || t.id || '/comments/' || c.id || '/avatar' END),
        'canReply',r.id IS NULL AND coalesce(t.owner_id=(SELECT id FROM viewer) AND (SELECT email_confirmed FROM viewer),false),
        'reply',CASE WHEN r.id IS NOT NULL THEN json_build_object(
          'id',r.id,'text',r.text,'createdAt',r.created_at,
          'author',json_build_object(
            'name',CASE WHEN ra.active THEN coalesce(nullif(btrim(ra.display_name),''),ra.first_name || ' ' || left(ra.last_name,1) || '.') END,
            'deactivated',NOT ra.active,'avatarUrl',CASE WHEN ra.active AND EXISTS(
              SELECT 1 FROM stored_files af WHERE af.id=ra.avatar_file_id AND af.owner_id=ra.id AND af.purpose='avatar' AND af.status='ready' AND af.avatar_24_bytes IS NOT NULL AND af.avatar_24_sha256 IS NOT NULL
            ) THEN '/api/tracks/' || t.id || '/comments/' || c.id || '/reply/avatar' END)) END
      ) ORDER BY c.created_at,c.id) FROM selected c JOIN users a ON a.id=c.author_id LEFT JOIN track_comment_replies r ON r.comment_id=c.id LEFT JOIN users ra ON ra.id=r.author_id),'[]'::json)
    ) AS result FROM accessible t,target WHERE t.id=${id}::uuid AND target.page IS NOT NULL
  `);
  return result.rows[0]?.result ?? null;
}

export function createTrackComment(
  dependencies: Dependencies & { input: unknown },
) {
  return createPost(dependencies);
}
export function createOwnerReply(
  dependencies: Dependencies & { input: unknown; commentId: string },
) {
  return createPost(dependencies);
}
async function createPost({
  db,
  token,
  id,
  input,
  commentId,
}: Dependencies & {
  input: unknown;
  commentId?: string;
}): Promise<CreatedDiscussionPost> {
  if (!isSessionToken(token)) throw new DiscussionError("unauthorized");
  const text = validateDiscussionText(input);
  if (
    !trackIdPattern.test(id) ||
    (commentId !== undefined && !trackIdPattern.test(commentId))
  )
    throw new DiscussionError("notFound");
  return db.transaction(async (tx) => {
    const identity = (await tx.execute<{ id: string }>(viewer(token))).rows[0];
    if (!identity) throw new DiscussionError("unauthorized");
    await tx.execute(
      sql`SELECT id FROM users WHERE id=${identity.id}::uuid OR id=(SELECT owner_id FROM tracks WHERE id=${id}::uuid) ORDER BY id FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM sessions WHERE ${currentLegalAcceptance(sql`sessions.user_id`)} AND user_id=${identity.id}::uuid AND token_hash=${hash(token)} FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM tracks WHERE id=${id}::uuid FOR UPDATE`,
    );
    const current = (
      await tx.execute<{
        email_confirmed: boolean;
      }>(sql`SELECT u.email_confirmed FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE u.id=${identity.id}::uuid AND u.active AND ${currentLegalAcceptance(sql`u.id`)} AND s.token_hash=${hash(token)} AND s.expires_at>clock_timestamp()`)
    ).rows[0];
    if (!current) throw new DiscussionError("unauthorized");
    const track = (
      await tx.execute<{ owner_id: string }>(
        sql`WITH viewer AS (${viewer(token)}), accessible AS (${accessible}) SELECT * FROM accessible WHERE id=${id}::uuid`,
      )
    ).rows[0];
    if (!track) throw new DiscussionError("notFound");
    if (!current.email_confirmed) throw new DiscussionError("emailUnconfirmed");
    if (commentId !== undefined) {
      const comment = (
        await tx.execute(
          sql`SELECT id FROM track_comments WHERE id=${commentId}::uuid AND track_id=${id}::uuid FOR UPDATE`,
        )
      ).rows[0];
      if (!comment) throw new DiscussionError("notFound");
      if (track.owner_id !== identity.id)
        throw new DiscussionError("forbidden");
      if (
        (
          await tx.execute(
            sql`SELECT id FROM track_comment_replies WHERE comment_id=${commentId}::uuid`,
          )
        ).rows.length
      )
        throw new DiscussionError("replyExists");
    }
    const limit = (
      await tx.execute<{
        blocked: boolean;
      }>(sql`SELECT count(*) >= 20 OR coalesce(max(created_at)>clock_timestamp()-interval '30 seconds',false) AS blocked
      FROM discussion_post_events WHERE author_id=${identity.id}::uuid AND created_at>clock_timestamp()-interval '1 hour'`)
    ).rows[0];
    if (limit.blocked) throw new DiscussionError("rateLimited");
    await tx.execute(
      sql`INSERT INTO discussion_post_events(author_id,created_at,updated_at) VALUES (${identity.id}::uuid,clock_timestamp(),clock_timestamp())`,
    );
    const post = (
      await tx.execute<{ id: string }>(
        commentId === undefined
          ? sql`INSERT INTO track_comments(track_id,author_id,text,created_at,updated_at) VALUES (${id}::uuid,${identity.id}::uuid,${text},clock_timestamp(),clock_timestamp()) RETURNING id`
          : sql`INSERT INTO track_comment_replies(comment_id,author_id,text,created_at,updated_at) VALUES (${commentId}::uuid,${identity.id}::uuid,${text},clock_timestamp(),clock_timestamp()) RETURNING id`,
      )
    ).rows[0];
    const page = await getTrackComments({
      db: tx,
      token,
      id,
      commentId: commentId ?? post.id,
    });
    if (!page) throw new DiscussionError("notFound");
    const session = (
      await tx.execute(
        sql`SELECT id FROM sessions WHERE ${currentLegalAcceptance(sql`sessions.user_id`)} AND token_hash=${hash(token)} AND user_id=${identity.id}::uuid AND expires_at>clock_timestamp()`,
      )
    ).rows[0];
    if (!session) throw new DiscussionError("unauthorized");
    return { id: post.id, commentId: commentId ?? post.id, page: page.page };
  });
}

/** Shared server-only read scope for discussion media; never cache request identity. */
export function discussionReadAccess(token: string | undefined) {
  return sql`WITH viewer AS (${viewer(token)}), accessible AS (${accessible})`;
}

import { isPendingLegalSession } from "../legal/authorization";
import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import type { ObjectStore } from "../storage/objects";
import { avatarVersionKey } from "../storage/avatar-versions";
import { DiscussionError, discussionReadAccess } from "./comments";
import { trackIdPattern } from "./validation";

export async function downloadDiscussionAvatar({
  db,
  token,
  store,
  id,
  commentId,
  reply = false,
}: {
  db: Pick<Database, "execute">;
  token: string | undefined;
  store: ObjectStore;
  id: string;
  commentId: string;
  reply?: boolean;
}) {
  if (await isPendingLegalSession(db, token))
    throw new DiscussionError("unauthorized");
  if (!trackIdPattern.test(id) || !trackIdPattern.test(commentId))
    throw new DiscussionError("notFound");
  const query = sql`${discussionReadAccess(token)}
    SELECT f.id,f.storage_location,f.avatar_24_bytes AS size,f.avatar_24_sha256 AS hash
    FROM accessible t JOIN track_comments c ON c.track_id=t.id
    LEFT JOIN track_comment_replies r ON r.comment_id=c.id
    JOIN users a ON a.id=${reply ? sql`r.author_id` : sql`c.author_id`} AND a.active
    JOIN stored_files f ON f.id=a.avatar_file_id AND f.owner_id=a.id AND f.purpose='avatar' AND f.status='ready'
    WHERE t.id=${id}::uuid AND c.id=${commentId}::uuid AND f.avatar_24_bytes IS NOT NULL AND f.avatar_24_sha256 IS NOT NULL`;
  type File = {
    id: string;
    storage_location: string;
    size: number;
    hash: string;
  };
  const file = (await db.execute<File>(query)).rows[0];
  if (!file) throw new DiscussionError("notFound");
  if (file.storage_location !== store.location)
    throw new DiscussionError("unavailable");
  const bytes = await store.get(avatarVersionKey(file.id, 24), file.size);
  if (
    !bytes ||
    bytes.length !== file.size ||
    createHash("sha256").update(bytes).digest("hex") !== file.hash
  )
    throw new DiscussionError("unavailable");
  // A slow object read must not return a removed avatar, hidden track or inactive identity.
  const current = (await db.execute<File>(query)).rows[0];
  if (!current || current.id !== file.id || current.hash !== file.hash)
    throw new DiscussionError("notFound");
  return { bytes };
}

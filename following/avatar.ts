import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { ObjectStore } from "../storage/objects";
import { avatarVersionKey } from "../storage/avatar-versions";
import { trackIdPattern } from "../tracks/validation";
import {
  followingIdentity,
  FollowingError,
  type FollowingDependencies,
} from "./service";
export async function downloadFollowingAvatar(
  d: FollowingDependencies & { id: string; store: ObjectStore },
) {
  const owner = await followingIdentity(d);
  if (!trackIdPattern.test(d.id)) throw new FollowingError("notFound");
  const query = sql`SELECT a.id,a.storage_location,a.avatar_24_bytes AS size,a.avatar_24_sha256 AS hash FROM uploader_follows f JOIN users u ON u.id=f.uploader_id AND u.active JOIN stored_files a ON a.id=u.avatar_file_id AND a.owner_id=u.id AND a.purpose='avatar' AND a.status='ready' WHERE f.follower_id=${owner}::uuid AND f.uploader_id=${d.id}::uuid AND a.avatar_24_bytes IS NOT NULL AND a.avatar_24_sha256 IS NOT NULL`;
  type File = {
    id: string;
    storage_location: string;
    size: number;
    hash: string;
  };
  const file = (await d.db.execute<File>(query)).rows[0];
  if (!file) throw new FollowingError("notFound");
  if (file.storage_location !== d.store.location)
    throw new FollowingError("unavailable");
  const bytes = await d.store.get(avatarVersionKey(file.id, 24), file.size);
  if (
    !bytes ||
    bytes.length !== file.size ||
    createHash("sha256").update(bytes).digest("hex") !== file.hash
  )
    throw new FollowingError("unavailable");
  const current = (await d.db.execute<File>(query)).rows[0];
  await followingIdentity(d);
  if (
    !current ||
    current.id !== file.id ||
    current.hash !== file.hash ||
    current.size !== file.size ||
    current.storage_location !== file.storage_location
  )
    throw new FollowingError("notFound");
  return { bytes };
}

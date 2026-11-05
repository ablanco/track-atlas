import type { Pool } from "pg";

/** Remove only fixture owners, keeping deferred publication checks enabled. */
export async function cleanupTrackOwners(
  pool: Pool,
  ownerIds: Iterable<string>,
) {
  const ids = [...ownerIds];
  if (!ids.length) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE track_photos SET track_id=NULL WHERE track_id IN (SELECT id FROM tracks WHERE owner_id=ANY($1::uuid[]))",
      [ids],
    );
    await client.query(
      "DELETE FROM track_photos WHERE id IN (SELECT id FROM stored_files WHERE owner_id=ANY($1::uuid[]))",
      [ids],
    );
    await client.query(
      "DELETE FROM track_upload_attempts WHERE owner_id=ANY($1::uuid[])",
      [ids],
    );
    await client.query("DELETE FROM tracks WHERE owner_id=ANY($1::uuid[])", [
      ids,
    ]);
    await client.query(
      "DELETE FROM stored_files WHERE owner_id=ANY($1::uuid[])",
      [ids],
    );
    await client.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

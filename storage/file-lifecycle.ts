import "server-only";
import { currentLegalAcceptance } from "../legal/authorization";
import { sql } from "drizzle-orm";
import type { Database, AuthTransaction } from "../auth/database";
import { FileError } from "./validation";

/** All physical writes/removals for one file share this transaction lock. Never
 * acquire an account lock inside it: publication locks accounts separately. */
export async function withFileStorageLock<T>(
  db: Pick<Database, "transaction">,
  id: string,
  work: (tx: AuthTransaction) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 40040))`,
    );
    return work(tx);
  });
}
export async function writeReservedFile(
  db: Pick<Database, "transaction">,
  id: string,
  write: () => Promise<void>,
  unavailable: () => Error = () => new FileError("unauthorized"),
) {
  return withFileStorageLock(db, id, async (tx) => {
    const eligible = await tx.execute(
      sql`SELECT f.id FROM stored_files f JOIN users u ON u.id=f.owner_id WHERE f.id=${id}::uuid AND f.status='pending' AND f.expires_at>clock_timestamp() AND u.active AND u.erasure_started_at IS NULL AND ${currentLegalAcceptance(sql`u.id`)}`,
    );
    if (!eligible.rows.length) throw unavailable();
    await write();
  });
}

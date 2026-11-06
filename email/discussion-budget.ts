import "server-only";
import { sql } from "drizzle-orm";
import type { Database } from "../auth/database";

/** Reserve before transport; failures never refund this separate UTC allowance. */
export async function reserveDiscussionEmailBudget(
  db: Pick<Database, "transaction">,
  limit: number,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Separate from account email. Choose the UTC day only after the lock wait.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(247192614)`);
    await tx.execute(sql`LOCK TABLE email_send_limits IN ROW EXCLUSIVE MODE`);
    const {
      rows: [clock],
    } = await tx.execute<{ day: string; now: string }>(
      sql`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,clock_timestamp() AS now`,
    );
    const key = `discussion:daily:${clock.day}`;
    await tx.execute(
      sql`INSERT INTO email_send_limits(key) VALUES (${key}) ON CONFLICT DO NOTHING`,
    );
    const {
      rows: [bucket],
    } = await tx.execute<{ count: number }>(
      sql`SELECT cardinality(attempted_at) AS count FROM email_send_limits WHERE key=${key} FOR UPDATE`,
    );
    if (bucket.count >= limit) return false;
    await tx.execute(
      sql`UPDATE email_send_limits SET attempted_at=array_append(attempted_at,${clock.now}::timestamptz) WHERE key=${key}`,
    );
    return true;
  });
}

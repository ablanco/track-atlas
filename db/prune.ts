import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { Database } from "../auth/database";

const batchSize = 1000;

/** One bounded batch per table. Repeated runs drain backlogs without long transactions. */
export async function pruneDatabase(db: Pick<Database, "transaction">) {
  const prune = async (table: string, key: string, eligible: SQL) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
      if (table === "email_send_limits") {
        // Writers INSERT before SELECT FOR UPDATE. Hold off new writers and wait
        // for existing transactions, so no bucket can disappear between those steps.
        await tx.execute(
          sql`LOCK TABLE email_send_limits IN SHARE ROW EXCLUSIVE MODE`,
        );
      }
      const result = await tx.execute(sql`
        WITH candidates AS (
          SELECT ${sql.identifier(key)} FROM ${sql.identifier(table)}
          WHERE ${eligible}
          ORDER BY ${sql.identifier(key)}
          LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
        )
        DELETE FROM ${sql.identifier(table)} AS target USING candidates
        WHERE target.${sql.identifier(key)} = candidates.${sql.identifier(key)}
      `);
      return result.rowCount ?? 0;
    });

  const sessions = await prune(
    "sessions",
    "id",
    sql`expires_at <= clock_timestamp()`,
  );
  const accountTokens = await prune(
    "account_action_tokens",
    "id",
    sql`expires_at <= clock_timestamp() OR consumed_at IS NOT NULL OR revoked_at IS NOT NULL`,
  );
  const captchaProofs = await prune(
    "captcha_uses",
    "challenge_hash",
    sql`expires_at <= clock_timestamp()`,
  );
  const emailLimits = await prune(
    "email_send_limits",
    "key",
    sql`(key LIKE 'address:%' AND NOT EXISTS (
      SELECT 1 FROM unnest(attempted_at) AS attempt
      WHERE attempt > clock_timestamp() - interval '1 hour'
    )) OR (
      (key LIKE 'daily:%' OR key LIKE 'discussion:daily:%')
      AND updated_at < date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(attempted_at) AS attempt
        WHERE attempt >= date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      )
    )`,
  );
  return { sessions, accountTokens, captchaProofs, emailLimits };
}

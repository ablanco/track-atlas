import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../auth/database";
export const isDigestToken = (token: unknown): token is string =>
  typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
/** Purpose-bound authority can only withdraw digest consent, never authenticate. */
export async function consumeDigestOptOut(
  db: Pick<Database, "execute" | "transaction">,
  token: string,
): Promise<boolean> {
  if (!isDigestToken(token)) return false;
  const hash = createHash("sha256").update(token).digest("hex");
  const {
    rows: [candidate],
  } = await db.execute<{ recipient_id: string }>(
    sql`SELECT recipient_id FROM digest_opt_out_tokens WHERE token_hash=${hash}`,
  );
  if (!candidate) return false;
  return db.transaction(async (tx) => {
    // Match preference/erasure order: account first, token last, then fresh clock.
    const {
      rows: [user],
    } = await tx.execute(
      sql`SELECT id FROM users WHERE id=${candidate.recipient_id}::uuid FOR UPDATE`,
    );
    if (!user) return false;
    const {
      rows: [live],
    } = await tx.execute(
      sql`SELECT id FROM digest_opt_out_tokens WHERE token_hash=${hash} AND recipient_id=${candidate.recipient_id}::uuid FOR UPDATE`,
    );
    if (!live) return false;
    const { rows } = await tx.execute(
      sql`UPDATE digest_opt_out_tokens SET consumed_at=clock_timestamp() WHERE token_hash=${hash} AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING id`,
    );
    if (!rows.length) return false;
    await tx.execute(
      sql`UPDATE users SET digest_emails_enabled=false,digest_resume_after=clock_timestamp() WHERE id=${candidate.recipient_id}::uuid`,
    );
    return true;
  });
}

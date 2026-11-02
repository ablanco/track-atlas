import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { isSessionToken } from "../auth/session-store";
import { DiscussionError } from "./comments";
import type { EmailLocale } from "../email/types";

export type DiscussionPreferences = {
  enabled: boolean;
  locale: EmailLocale | null;
};
type Dependencies = {
  db: Pick<Database, "execute" | "transaction">;
  token: string | undefined;
};
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const preferences = sql`u.discussion_emails_enabled AS enabled, u.discussion_email_locale AS locale`;

export async function getDiscussionPreferences({
  db,
  token,
}: Dependencies): Promise<DiscussionPreferences> {
  if (!isSessionToken(token)) throw new DiscussionError("unauthorized");
  const result =
    await db.execute<DiscussionPreferences>(sql`SELECT ${preferences} FROM users u JOIN sessions s ON s.user_id=u.id
    WHERE u.active AND s.token_hash=${digest(token)} AND s.expires_at>clock_timestamp()`);
  if (!result.rows[0]) throw new DiscussionError("unauthorized");
  return result.rows[0];
}

export async function updateDiscussionPreferences({
  db,
  token,
  input,
}: Dependencies & { input: unknown }): Promise<DiscussionPreferences> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 2 ||
    !("enabled" in input) ||
    typeof input.enabled !== "boolean" ||
    !("locale" in input) ||
    !["en", "es"].includes(input.locale as string)
  )
    throw new DiscussionError("invalidRequest");
  if (!isSessionToken(token)) throw new DiscussionError("unauthorized");
  const enabled = input.enabled;
  const locale = input.locale as EmailLocale;
  return db.transaction(async (tx) => {
    const identity = (
      await tx.execute<{
        id: string;
      }>(sql`SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE u.active AND s.token_hash=${digest(token)} AND s.expires_at>clock_timestamp()`)
    ).rows[0];
    if (!identity) throw new DiscussionError("unauthorized");
    await tx.execute(
      sql`SELECT id FROM users WHERE id=${identity.id}::uuid FOR UPDATE`,
    );
    const lockedSession = await tx.execute(
      sql`SELECT id FROM sessions WHERE user_id=${identity.id}::uuid AND token_hash=${digest(token)} FOR UPDATE`,
    );
    if (!lockedSession.rows.length) throw new DiscussionError("unauthorized");
    // Recheck after both lock waits, and again after the write before commit.
    await getDiscussionPreferences({ db: tx, token });
    await tx.execute(
      sql`UPDATE users SET discussion_emails_enabled=${enabled},discussion_email_locale=${locale} WHERE id=${identity.id}::uuid`,
    );
    return getDiscussionPreferences({ db: tx, token });
  });
}

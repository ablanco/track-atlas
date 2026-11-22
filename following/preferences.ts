import "server-only";
import { sql } from "drizzle-orm";
import { isSupportedLocale } from "../i18n/locales";
import {
  followingIdentity,
  FollowingError,
  withFollowingAccount,
  type FollowingDependencies,
} from "./service";
import type { DigestPreferences } from "./types";
export async function getDigestPreferences(
  d: FollowingDependencies,
): Promise<DigestPreferences> {
  const id = await followingIdentity(d);
  const result = (
    await d.db.execute<DigestPreferences>(
      sql`SELECT digest_emails_enabled AS enabled,digest_email_locale AS locale FROM users WHERE id=${id}::uuid`,
    )
  ).rows[0];
  await followingIdentity(d);
  return result;
}
export async function updateDigestPreferences(
  d: FollowingDependencies & { input: unknown },
): Promise<DigestPreferences> {
  const input = d.input;
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 2 ||
    !("enabled" in input) ||
    typeof input.enabled !== "boolean" ||
    !("locale" in input) ||
    !isSupportedLocale(input.locale)
  )
    throw new FollowingError("invalidRequest");
  const enabled = input.enabled,
    locale = input.locale;
  return withFollowingAccount(d, [], async (tx, id) => {
    const old = await getDigestPreferences({ ...d, db: tx });
    await tx.execute(
      sql`UPDATE users SET digest_emails_enabled=${enabled},digest_email_locale=${locale},digest_resume_after=CASE WHEN digest_emails_enabled<>${enabled} THEN clock_timestamp() ELSE digest_resume_after END WHERE id=${id}::uuid`,
    );
    if (enabled && !old.enabled)
      await tx.execute(
        sql`DELETE FROM digest_opt_out_tokens WHERE recipient_id=${id}::uuid`,
      );
    return getDigestPreferences({ ...d, db: tx });
  });
}

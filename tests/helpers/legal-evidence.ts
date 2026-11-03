import type { Pool } from "pg";
import { legalDocuments } from "../../legal/documents";
/** Explicit legal evidence for browser fixtures that test other account features. */
export async function acceptFixtureDocuments(pool: Pool, account: string) {
  await pool.query(
    `INSERT INTO legal_acceptances(user_id,terms_version,privacy_version,locale)
    SELECT id,$2,$3,'en' FROM users WHERE id::text=$1 OR email=$1`,
    [
      account,
      legalDocuments.terms.currentVersion,
      legalDocuments.privacy.currentVersion,
    ],
  );
}

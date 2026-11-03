import "server-only";
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { legalDocuments } from "./documents";

/** Evaluate in the authorization statement, never a shared or session-lifetime cache.
 * Exact historical revisions remain valid within their current material generation.
 */
export function currentLegalAcceptance(userId: SQLWrapper): SQL<boolean> {
  const versions = (document: "terms" | "privacy") =>
    sql.join(
      legalDocuments[document].revisions
        .filter(
          (revision) =>
            revision.requiredVersion ===
            legalDocuments[document].requiredVersion,
        )
        .map((revision) => sql`${revision.version}`),
      sql`, `,
    );
  if (
    ["terms", "privacy"].some((document) => {
      const entry = legalDocuments[document as "terms" | "privacy"];
      return !entry.revisions.some(
        (revision) => revision.requiredVersion === entry.requiredVersion,
      );
    })
  )
    return sql<boolean>`false`;
  return sql<boolean>`EXISTS (SELECT 1 FROM legal_acceptances legal_evidence
    WHERE legal_evidence.user_id=${userId}
    AND legal_evidence.terms_version IN (${versions("terms")})
    AND legal_evidence.privacy_version IN (${versions("privacy")}))`;
}

/** Public reads can admit guests, but never silently downgrade a pending session. */
export async function isPendingLegalSession(
  db: Pick<import("../auth/database").Database, "execute">,
  token: string | undefined,
) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const { createHash } = await import("node:crypto");
  const result =
    await db.execute(sql`SELECT 1 FROM users legal_viewer JOIN sessions legal_session ON legal_session.user_id=legal_viewer.id
    WHERE legal_viewer.active AND legal_session.token_hash=${createHash("sha256").update(token).digest("hex")}
    AND legal_session.expires_at>clock_timestamp() AND NOT ${currentLegalAcceptance(sql`legal_viewer.id`)}`);
  return result.rows.length > 0;
}

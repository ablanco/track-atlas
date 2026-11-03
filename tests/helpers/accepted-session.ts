import type { AuthExecutor } from "../../auth/database";
import { createSession } from "../../auth/session-store";
import { appendLegalAcceptance } from "../../legal/acceptance-store";
import { legalDocuments } from "../../legal/documents";
/** Existing feature fixtures explicitly accept published documents before sign-in. */
export async function createAcceptedSession(db: AuthExecutor, userId: string) {
  await appendLegalAcceptance(db, userId, {
    termsVersion: legalDocuments.terms.currentVersion,
    privacyVersion: legalDocuments.privacy.currentVersion,
    locale: "en",
  });
  return createSession(db, userId);
}

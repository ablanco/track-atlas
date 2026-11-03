import "server-only";
import { asc, eq } from "drizzle-orm";
import type { AuthExecutor } from "../auth/database";
import { legalAcceptances } from "../db/schema";
import {
  isCurrentLegalAcceptance,
  type LegalAcceptanceInput,
} from "./acceptance-input";

/** Internal persistence boundary: callers authorize userId from a session or new account.
 * Pass the account transaction so evidence commits with its authorized mutation.
 * Renewal always appends; historical evidence is never updated.
 */
export async function appendLegalAcceptance(
  executor: Pick<AuthExecutor, "insert">,
  userId: string,
  input: LegalAcceptanceInput,
) {
  if (!isCurrentLegalAcceptance(input))
    throw new Error("Invalid legal acceptance");
  const [evidence] = await executor
    .insert(legalAcceptances)
    .values({
      userId,
      termsVersion: input.termsVersion,
      privacyVersion: input.privacyVersion,
      locale: input.locale,
    })
    .returning();
  return evidence;
}

/** Internal account evidence, ordered oldest first; never a public account-ID API. */
export async function listLegalAcceptances(
  executor: Pick<AuthExecutor, "select">,
  userId: string,
) {
  return executor
    .select()
    .from(legalAcceptances)
    .where(eq(legalAcceptances.userId, userId))
    .orderBy(asc(legalAcceptances.acceptedAt), asc(legalAcceptances.id));
}

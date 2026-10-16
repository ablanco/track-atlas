import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { accountActionTokens, users } from "../db/schema";
import type { AuthTransaction, Database } from "./database";
import { createAccountToken, hashAccountToken, isAccountToken } from "./account-token";
import type { AccountEmailPurpose } from "../email/types";
export type IssuedAccountEmail = { userId: string; email: string; firstName: string; purpose: AccountEmailPurpose; token: string; expiresAt: Date };
export type AccountLinkResult = { ok: true } | { ok: false; reason: "invalid" | "unavailable" };
type TokenDb = Pick<Database, "select" | "transaction">;
export async function issueAccountToken(tx: AuthTransaction, user: { id: string; email: string; firstName: string }, purpose: AccountEmailPurpose): Promise<IssuedAccountEmail> {
  const { token, tokenHash } = createAccountToken();
  const [row] = await tx.insert(accountActionTokens).values({ userId: user.id, purpose, tokenHash, expiresAt: sql`clock_timestamp() + ${purpose === "email-confirmation" ? 86400 : 3600} * interval '1 second'` }).returning({ expiresAt: accountActionTokens.expiresAt });
  return { userId: user.id, email: user.email, firstName: user.firstName, purpose, token, expiresAt: row.expiresAt };
}
export function usableToken(purpose: AccountEmailPurpose, token: string) {
  return and(eq(accountActionTokens.tokenHash, hashAccountToken(token)), eq(accountActionTokens.purpose, purpose), isNull(accountActionTokens.consumedAt), isNull(accountActionTokens.revokedAt), gt(accountActionTokens.expiresAt, sql`clock_timestamp()`));
}
export async function accountTokenCandidate(db: Pick<Database, "select">, purpose: AccountEmailPurpose, token: unknown) {
  if (!isAccountToken(token)) return null;
  const [row] = await db.select({ id: users.id, passwordHash: users.passwordHash, emailConfirmed: users.emailConfirmed })
    .from(accountActionTokens).innerJoin(users, eq(users.id, accountActionTokens.userId)).where(and(usableToken(purpose, token), eq(users.active, true))).limit(1);
  return row ?? null;
}
export async function inspectAccountToken(db: TokenDb, purpose: AccountEmailPurpose, token: unknown): Promise<"valid" | "already-confirmed" | "invalid"> {
  const user = await accountTokenCandidate(db, purpose, token);
  return !user ? "invalid" : purpose === "email-confirmation" && user.emailConfirmed ? "already-confirmed" : "valid";
}
export async function revokeAccountTokens(tx: AuthTransaction, userId: string, purpose?: AccountEmailPurpose): Promise<void> {
  await tx.update(accountActionTokens).set({ revokedAt: sql`clock_timestamp()` }).where(and(eq(accountActionTokens.userId, userId), isNull(accountActionTokens.revokedAt), isNull(accountActionTokens.consumedAt), purpose ? eq(accountActionTokens.purpose, purpose) : undefined));
}
export async function consumeAccountToken(db: TokenDb, purpose: AccountEmailPurpose, token: string,
  prepare: () => Promise<(tx: AuthTransaction, userId: string) => Promise<void>>): Promise<AccountLinkResult> {
  try {
    const candidate = await accountTokenCandidate(db, purpose, token);
    if (!candidate) return { ok: false, reason: "invalid" };
    const mutate = await prepare();
    return await db.transaction(async tx => {
      const [user] = await tx.select({ active: users.active, passwordHash: users.passwordHash }).from(users).where(eq(users.id, candidate.id)).for("update");
      if (!user?.active || (purpose === "password-reset" && user.passwordHash !== candidate.passwordHash)) return { ok: false, reason: "invalid" };
      const [row] = await tx.select({ id: accountActionTokens.id }).from(accountActionTokens)
        .where(and(usableToken(purpose, token), eq(accountActionTokens.userId, candidate.id))).for("update");
      if (!row) return { ok: false, reason: "invalid" };
      // Recheck the clock after token-row lock waits as well.
      const [consumed] = await tx.update(accountActionTokens).set({ consumedAt: sql`clock_timestamp()` })
        .where(and(eq(accountActionTokens.id, row.id), usableToken(purpose, token))).returning({ id: accountActionTokens.id });
      if (!consumed) return { ok: false, reason: "invalid" };
      await mutate(tx, candidate.id); await revokeAccountTokens(tx, candidate.id, purpose);
      return { ok: true };
    });
  } catch { return { ok: false, reason: "unavailable" }; }
}

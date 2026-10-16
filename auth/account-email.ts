import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { users, sessions } from "../db/schema";
import { getEmailConfig } from "../email/config";
import { buildAccountEmailUrl, renderAccountEmail } from "../email/templates";
import type { EmailLocale, SendEmail, EmailSendResult } from "../email/types";
import type { Database } from "./database";
import { issueAccountToken, type IssuedAccountEmail } from "./account-token-store";
import { getEmailRateKey, readEmailCooldown, reserveEmailDailyBudget, reserveEmailRequest } from "./email-rate-limit";
import { findSessionUser, isSessionToken } from "./session-store";
import { hashAccountToken } from "./account-token";

type EmailDb = Pick<Database, "select" | "transaction" | "execute">;
export type ConfirmationRequestResult = { ok: true; retryAfterSeconds: number } | { ok: false; reason: "unauthorized" | "unavailable" | "throttled"; retryAfterSeconds?: number };
export async function deliverIssuedAccountEmail(db: EmailDb, issued: IssuedAccountEmail, locale: EmailLocale, send: SendEmail): Promise<EmailSendResult> {
  try {
    const config = getEmailConfig();
    const content = renderAccountEmail(issued.purpose, locale, issued.firstName, buildAccountEmailUrl(config.origin, locale, issued.purpose, issued.token));
    if (!await reserveEmailDailyBudget(db)) return { ok: false, reason: "unavailable" };
    return await send({ to: { email: issued.email, name: issued.firstName }, ...content });
  } catch { return { ok: false, reason: "unavailable" }; }
}
export async function requestPasswordReset(db: EmailDb, email: string, locale: EmailLocale, send: SendEmail): Promise<void> {
  const config = getEmailConfig();
  const reservation = await reserveEmailRequest(db, "password-reset", await getEmailRateKey(db,email,config.rateSecret));
  if (!reservation.allowed) return;
  const [candidate] = await db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(and(sql`lower(${users.email}) = lower(${email})`, eq(users.active, true))).limit(1);
  if (!candidate) return;
  const issued = await db.transaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id, candidate.id)).for("update");
    if (!user?.active || user.passwordHash !== candidate.passwordHash) return null;
    return issueAccountToken(tx, user, "password-reset");
  });
  if (issued) await deliverIssuedAccountEmail(db, issued, locale, send);
}
export async function requestEmailConfirmation(db: EmailDb, sessionToken: string, locale: EmailLocale, send: SendEmail): Promise<ConfirmationRequestResult> {
  try {
    if (!isSessionToken(sessionToken)) return { ok: false, reason: "unauthorized" };
    const identity = await findSessionUser(db, sessionToken);
    if (!identity) return { ok: false, reason: "unauthorized" };
    const [candidate] = await db.select({ email: users.email }).from(users).where(eq(users.id, identity.userId));
    const config = getEmailConfig();
    const key = await getEmailRateKey(db,candidate.email,config.rateSecret);
    const reservation = await reserveEmailRequest(db, "email-confirmation", key);
    if (!reservation.allowed) return { ok: false, reason: "throttled", retryAfterSeconds: reservation.retryAfterSeconds };
    const issued = await db.transaction(async tx => {
      const [user] = await tx.select().from(users).where(eq(users.id, identity.userId)).for("update");
      if (!user?.active) return undefined;
      const [session] = await tx.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, user.id), eq(sessions.tokenHash, hashAccountToken(sessionToken)), gt(sessions.expiresAt, sql`clock_timestamp()`))).for("update");
      if (!session) return undefined;
      if (user.emailConfirmed) return null;
      return issueAccountToken(tx, user, "email-confirmation");
    });
    if (issued === undefined) return { ok: false, reason: "unauthorized" };
    const delivery = issued ? await deliverIssuedAccountEmail(db, issued, locale, send) : null;
    const retryAfterSeconds = issued ? await readEmailCooldown(db,"email-confirmation",key) : 0;
    if (delivery && !delivery.ok) return { ok: false, reason: "unavailable", retryAfterSeconds };
    return { ok: true, retryAfterSeconds };
  } catch { return { ok: false, reason: "unavailable" }; }
}

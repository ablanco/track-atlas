import "server-only";
import { createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { emailSendLimits } from "../db/schema";
import type { Database } from "./database";
import type { AccountEmailPurpose } from "../email/types";
export type EmailLimitResult =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };
export function emailRateKey(email: string, secret: string) {
  return createHmac("sha256", secret)
    .update(email.trim().toLowerCase())
    .digest("hex");
}
export async function getEmailRateKey(
  db: Pick<Database, "execute">,
  email: string,
  secret: string,
): Promise<string> {
  // PostgreSQL owns account identity (including Unicode case mapping), just as
  // the unique index and login lookup do. No account lookup is needed here.
  const {
    rows: [row],
  } = await db.execute<{ normalized: string }>(
    sql`SELECT lower(${email.trim()}::text) AS normalized`,
  );
  return createHmac("sha256", secret).update(row.normalized).digest("hex");
}
type LimitDb = Pick<Database, "select" | "transaction">;
function remaining(attempts: Date[], now: number) {
  const active = attempts
    .map((d) => d.getTime())
    .filter((t) => t > now - 3600000)
    .sort((a, b) => a - b);
  return Math.max(
    0,
    Math.ceil(
      (Math.max(
        (active.at(-1) ?? 0) + 60000,
        active.length >= 3 ? active[0] + 3600000 : 0,
      ) -
        now) /
        1000,
    ),
  );
}
export async function readEmailCooldown(
  db: LimitDb,
  purpose: AccountEmailPurpose,
  key: string,
): Promise<number> {
  const [row] = await db
    .select({
      attempts: emailSendLimits.attemptedAt,
      now: sql<Date>`clock_timestamp()`,
    })
    .from(emailSendLimits)
    .where(eq(emailSendLimits.key, `address:${purpose}:${key}`));
  return row ? remaining(row.attempts, new Date(row.now).getTime()) : 0;
}
export async function reserveEmailRequest(
  db: LimitDb,
  purpose: AccountEmailPurpose,
  key: string,
): Promise<EmailLimitResult> {
  return db.transaction(async (tx) => {
    const bucket = `address:${purpose}:${key}`;
    await tx
      .insert(emailSendLimits)
      .values({ key: bucket })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(emailSendLimits)
      .where(eq(emailSendLimits.key, bucket))
      .for("update");
    const {
      rows: [{ now }],
    } = await tx.execute<{ now: string }>(sql`SELECT clock_timestamp() AS now`);
    const time = new Date(now).getTime();
    const retryAfterSeconds = remaining(row.attemptedAt, time);
    if (retryAfterSeconds) return { allowed: false, retryAfterSeconds };
    await tx
      .update(emailSendLimits)
      .set({
        attemptedAt: [
          ...row.attemptedAt.filter((d) => d.getTime() > time - 3600000),
          new Date(time),
        ],
      })
      .where(eq(emailSendLimits.key, bucket));
    return { allowed: true };
  });
}
export async function reserveEmailDailyBudget(db: LimitDb): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Transaction-scoped advisory lock serializes the UTC date decision too,
    // including a midnight crossed while waiting for the previous sender.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(247192613)`);
    const {
      rows: [{ day, now }],
    } = await tx.execute<{ day: string; now: string }>(
      sql`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') AS day, clock_timestamp() AS now`,
    );
    const bucket = `daily:${day}`;
    await tx
      .insert(emailSendLimits)
      .values({ key: bucket })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(emailSendLimits)
      .where(eq(emailSendLimits.key, bucket))
      .for("update");
    if (row.attemptedAt.length >= 250) return false;
    await tx
      .update(emailSendLimits)
      .set({ attemptedAt: [...row.attemptedAt, new Date(now)] })
      .where(eq(emailSendLimits.key, bucket));
    return true;
  });
}

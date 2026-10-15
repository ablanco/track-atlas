import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { sessions, users } from "../db/schema";
import type { AuthExecutor } from "./database";
import type { Database } from "./database";

export type SessionIdentity = { userId: string };
export type IssuedSession = { token: string; expiresAt: Date };

export function isSessionToken(token: string | undefined): token is string {
  return !!token && /^[A-Za-z0-9_-]{43}$/.test(token) && Buffer.from(token, "base64url").toString("base64url") === token;
}

export async function createSession(executor: AuthExecutor, userId: string): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const [session] = await executor.insert(sessions).values({
    userId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: sql`statement_timestamp() + interval '30 days'`,
  }).returning({ expiresAt: sessions.expiresAt });
  return { token, expiresAt: session.expiresAt };
}

export async function findSessionUser(executor: AuthExecutor, token: string | undefined): Promise<SessionIdentity | null> {
  if (!isSessionToken(token)) return null;
  const [user] = await executor.select({ userId: users.id }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, createHash("sha256").update(token).digest("hex")), gt(sessions.expiresAt, sql`statement_timestamp()`), eq(users.active, true))).limit(1);
  return user ?? null;
}

export async function revokeSession(executor: Pick<Database, "delete">, token: string | undefined): Promise<void> {
  if (!isSessionToken(token)) return;
  await executor.delete(sessions).where(eq(sessions.tokenHash, createHash("sha256").update(token).digest("hex")));
}

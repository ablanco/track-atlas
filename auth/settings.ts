import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { sessions, storedFiles, users } from "../db/schema";
import type { Database } from "./database";
import { hashPassword } from "./password";
import { revokeAccountTokens } from "./account-token-store";
import { findSessionUser, isSessionToken } from "./session-store";
import type { PasswordInput, ProfileInput, ProfileValues } from "./settings-validation";

type SettingsDatabase = Pick<Database, "select" | "transaction">;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type SettingsProfile = ProfileValues & { email: string; dateOfBirth: string; emailConfirmed: boolean; avatarFileId: string | null; avatarHasVersions: boolean };
export type SettingsResult = { ok: true } | { ok: false; reason: "unauthorized" | "unavailable" };

export async function getSettingsProfile(db: Pick<Database, "select">, token: string | undefined): Promise<SettingsProfile | null> {
  if (!isSessionToken(token)) return null;
  const [profile] = await db.select({ firstName: users.firstName, lastName: users.lastName, displayName: users.displayName, email: users.email, dateOfBirth: users.dateOfBirth, emailConfirmed: users.emailConfirmed, avatarFileId: users.avatarFileId, avatarHasVersions: sql<boolean>`${storedFiles.status} = 'ready' AND ${storedFiles.avatar128Bytes} IS NOT NULL` })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId)).leftJoin(storedFiles, eq(storedFiles.id, users.avatarFileId))
    .where(and(eq(sessions.tokenHash, digest(token)), gt(sessions.expiresAt, sql`clock_timestamp()`), eq(users.active, true))).limit(1);
  return profile ? { ...profile, avatarHasVersions: !!profile.avatarHasVersions, displayName: profile.displayName ?? "" } : null;
}

function digest(token: string) { return createHash("sha256").update(token).digest("hex"); }

// Always lock user before session, matching login's ordering. Recheck after the
// user lock: preflight may predate hashing, revocation, or a long lock wait.
async function authorizeLocked(tx: Transaction, userId: string, token: string): Promise<boolean> {
  const [user] = await tx.select({ active: users.active }).from(users).where(eq(users.id, userId)).for("update");
  if (!user?.active) return false;
  const [session] = await tx.select({ id: sessions.id }).from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.tokenHash, digest(token)), gt(sessions.expiresAt, sql`clock_timestamp()`))).for("update");
  return !!session;
}

async function mutateAccount(db: SettingsDatabase, token: string | undefined,
  prepare: () => Promise<(tx: Transaction, userId: string, token: string) => Promise<void>>,
): Promise<SettingsResult> {
  try {
    if (!isSessionToken(token)) return { ok: false, reason: "unauthorized" };
    const user = await findSessionUser(db, token);
    if (!user) return { ok: false, reason: "unauthorized" };
    const mutate = await prepare();
    return await db.transaction(async tx => {
      if (!(await authorizeLocked(tx, user.userId, token))) return { ok: false, reason: "unauthorized" } as const;
      await mutate(tx, user.userId, token);
      return { ok: true } as const;
    });
  } catch { return { ok: false, reason: "unavailable" }; }
}

export async function updateProfile(db: SettingsDatabase, token: string | undefined, input: ProfileInput): Promise<SettingsResult> {
  return mutateAccount(db, token, async () => async (tx, userId) => {
    // Explicit fields: service callers cannot smuggle immutable account columns.
    await tx.update(users).set({ firstName: input.firstName, lastName: input.lastName, displayName: input.displayName }).where(eq(users.id, userId));
  });
}

export async function updatePassword(db: SettingsDatabase, token: string | undefined, input: PasswordInput): Promise<SettingsResult> {
  return mutateAccount(db, token, async () => {
    const passwordHash = await hashPassword(input.password);
    return async (tx, userId, currentToken) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
      await revokeAccountTokens(tx, userId, "password-reset");
      await tx.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, digest(currentToken))));
    };
  });
}

export async function deactivateAccount(db: SettingsDatabase, token: string | undefined): Promise<SettingsResult> {
  return mutateAccount(db, token, async () => async (tx, userId) => {
    await tx.update(users).set({ active: false }).where(eq(users.id, userId));
    await revokeAccountTokens(tx, userId);
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
}

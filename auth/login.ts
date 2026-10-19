import "server-only";
import { eq, sql } from "drizzle-orm";
import { users } from "../db/schema";
import type { AuthDatabase } from "./database";
import { verifyPassword } from "./password";
import {
  createSession,
  revokeSession,
  type IssuedSession,
} from "./session-store";
import type { LoginInput } from "./login-validation";

export type LoginResult =
  | { ok: true; session: IssuedSession }
  | { ok: false; reason: "invalidCredentials" | "unavailable" };

export async function loginUser(
  db: AuthDatabase,
  input: LoginInput,
  previousToken?: string,
): Promise<LoginResult> {
  try {
    const [user] = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        active: users.active,
      })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${input.email})`)
      .limit(1);
    const valid = await verifyPassword(
      input.password,
      user?.passwordHash ?? null,
    );
    if (!valid || !user?.active)
      return { ok: false, reason: "invalidCredentials" };
    return await db.transaction(async (tx) => {
      // Serialize with account changes; do not issue a session for an account
      // disabled or whose credentials changed while scrypt was running.
      const [current] = await tx
        .select({ active: users.active, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, user.id))
        .for("update");
      if (!current?.active || current.passwordHash !== user.passwordHash)
        return { ok: false, reason: "invalidCredentials" } as const;
      await revokeSession(tx, previousToken);
      return { ok: true, session: await createSession(tx, user.id) } as const;
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

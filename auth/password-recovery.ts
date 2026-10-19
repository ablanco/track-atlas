import "server-only";
import { eq } from "drizzle-orm";
import { sessions, users } from "../db/schema";
import type { Database } from "./database";
import type { PasswordInput } from "./settings-validation";
import { hashPassword } from "./password";
import { consumeAccountToken } from "./account-token-store";
export async function resetAccountPassword(
  db: Pick<Database, "select" | "transaction">,
  token: string,
  input: PasswordInput,
) {
  return consumeAccountToken(db, "password-reset", token, async () => {
    const passwordHash = await hashPassword(input.password);
    return async (tx, userId) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    };
  });
}

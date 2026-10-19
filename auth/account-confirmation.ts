import "server-only";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import type { Database } from "./database";
import { consumeAccountToken } from "./account-token-store";
export async function confirmAccountEmail(
  db: Pick<Database, "select" | "transaction">,
  token: string,
) {
  return consumeAccountToken(
    db,
    "email-confirmation",
    token,
    async () => async (tx, userId) => {
      await tx
        .update(users)
        .set({ emailConfirmed: true })
        .where(eq(users.id, userId));
    },
  );
}

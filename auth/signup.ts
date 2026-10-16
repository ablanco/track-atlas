import "server-only";
import { users } from "../db/schema";
import type { AuthDatabase } from "./database";
import { hashPassword } from "./password";
import { createSession, type IssuedSession } from "./session-store";
import type { SignupInput } from "./validation";
import { issueAccountToken, type IssuedAccountEmail } from "./account-token-store";
import { reserveEmailRequest } from "./email-rate-limit";

export type SignupResult = { ok: true; session: IssuedSession; confirmation: IssuedAccountEmail; confirmationSendAllowed: boolean } | { ok: false; reason: "emailTaken" | "unavailable" };

function isDuplicateEmail(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as { code?: unknown; constraint?: unknown; cause?: unknown };
  return (failure.code === "23505" && failure.constraint === "users_email_unique") || (failure.cause !== error && isDuplicateEmail(failure.cause));
}

export async function registerUser(db: AuthDatabase, input: SignupInput, emailKey: string): Promise<SignupResult> {
  try {
    const reservation = await reserveEmailRequest(db, "email-confirmation", emailKey);
    const passwordHash = await hashPassword(input.password);
    const result = await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: input.displayName,
        email: input.email,
        dateOfBirth: input.dateOfBirth,
        passwordHash,
      }).returning({ id: users.id, email: users.email, firstName: users.firstName });
      const confirmation = await issueAccountToken(tx, user, "email-confirmation");
      return { session: await createSession(tx, user.id), confirmation };
    });
    return { ok: true, ...result, confirmationSendAllowed: reservation.allowed };
  } catch (error) {
    return { ok: false, reason: isDuplicateEmail(error) ? "emailTaken" : "unavailable" };
  }
}

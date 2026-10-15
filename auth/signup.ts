import "server-only";
import { users } from "../db/schema";
import type { AuthDatabase } from "./database";
import { hashPassword } from "./password";
import { createSession, type IssuedSession } from "./session-store";
import type { SignupInput } from "./validation";

export type SignupResult = { ok: true; session: IssuedSession } | { ok: false; reason: "emailTaken" | "unavailable" };

function isDuplicateEmail(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as { code?: unknown; constraint?: unknown; cause?: unknown };
  return (failure.code === "23505" && failure.constraint === "users_email_unique") || (failure.cause !== error && isDuplicateEmail(failure.cause));
}

export async function registerUser(db: AuthDatabase, input: SignupInput): Promise<SignupResult> {
  try {
    const passwordHash = await hashPassword(input.password);
    const session = await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: input.displayName,
        email: input.email,
        dateOfBirth: input.dateOfBirth,
        passwordHash,
      }).returning({ id: users.id });
      return createSession(tx, user.id);
    });
    return { ok: true, session };
  } catch (error) {
    return { ok: false, reason: isDuplicateEmail(error) ? "emailTaken" : "unavailable" };
  }
}

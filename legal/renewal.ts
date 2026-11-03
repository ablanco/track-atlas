import "server-only";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { findSessionIdentity } from "../auth/session-store";
import { sessions, users } from "../db/schema";
import { appendLegalAcceptance } from "./acceptance-store";
import { isCurrentLegalAcceptance } from "./acceptance-input";
import { currentLegalAcceptance } from "./authorization";

export async function renewLegalAcceptance(
  db: Pick<Database, "select" | "transaction">,
  token: string | undefined,
  locale: string,
  form: FormData,
): Promise<"accepted" | "invalid" | "unauthorized"> {
  const single = (key: string) => {
    const values = form.getAll(key);
    return values.length === 1 && typeof values[0] === "string"
      ? values[0]
      : null;
  };
  const input = {
    termsVersion: single("termsVersion")!,
    privacyVersion: single("privacyVersion")!,
    locale: locale as "en" | "es",
  };
  if (
    single("termsAccepted") !== "on" ||
    single("privacyAcknowledged") !== "on" ||
    !isCurrentLegalAcceptance(input)
  )
    return "invalid";
  const identity = await findSessionIdentity(db, token);
  if (!identity || !token) return "unauthorized";
  return db.transaction(async (tx) => {
    // Same user -> session ordering as login, settings and erasure. Read the DB
    // clock after both locks; never authorize using the preflight identity.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, identity.userId))
      .for("update");
    await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, identity.userId),
          eq(
            sessions.tokenHash,
            createHash("sha256").update(token).digest("hex"),
          ),
        ),
      )
      .for("update");
    if (!(await findSessionIdentity(tx, token))) return "unauthorized";
    if (!isCurrentLegalAcceptance(input)) return "invalid";
    const [status] = await tx
      .select({ current: currentLegalAcceptance(sql`users.id`) })
      .from(users)
      .where(eq(users.id, identity.userId));
    if (!status?.current)
      await appendLegalAcceptance(tx, identity.userId, input);
    return "accepted";
  });
}

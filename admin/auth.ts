import "server-only";
import type { Database } from "../auth/database";
import { findSessionUser } from "../auth/session-store";
import { AdminError } from "./types";
export async function requireAdmin(
  db: Pick<Database, "select">,
  token: string | undefined,
) {
  const user = await findSessionUser(db, token);
  if (!user) throw new AdminError("unauthorized");
  if (!user.admin) throw new AdminError("forbidden");
  return user;
}

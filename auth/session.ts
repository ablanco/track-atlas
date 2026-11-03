import "server-only";
import { cookies } from "next/headers";
import { getDb } from "../db";
import { findSessionIdentity, isSessionToken } from "./session-store";

export const SESSION_COOKIE_NAME = "track_atlas_session";

export function sessionCookieOptions(expires: Date, production: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: production,
    path: "/",
    expires,
  };
}

/** Request-time identity for chrome and account links, including pending users.
 * Feature authorization belongs to findSessionUser and the service predicates. */
export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isSessionToken(token)) return null;
  return findSessionIdentity(getDb(), token);
}

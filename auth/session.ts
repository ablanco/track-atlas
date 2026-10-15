import "server-only";
import { cookies } from "next/headers";
import { getDb } from "../db";
import { findSessionUser, isSessionToken } from "./session-store";

export const SESSION_COOKIE_NAME = "track_atlas_session";

export function sessionCookieOptions(expires: Date, production: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure: production, path: "/", expires };
}

export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isSessionToken(token)) return null;
  return findSessionUser(getDb(), token);
}

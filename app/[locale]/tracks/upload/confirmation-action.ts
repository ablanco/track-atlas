"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { getDb } from "@/db";
import { getSettingsProfile } from "@/auth/settings";
import { SESSION_COOKIE_NAME } from "@/auth/session";

export async function checkUploadConfirmation(): Promise<
  "confirmed" | "unconfirmed" | "unauthorized" | "unavailable"
> {
  try {
    const profile = await getSettingsProfile(
      getDb(),
      (await cookies()).get(SESSION_COOKIE_NAME)?.value,
    );
    if (!profile) return "unauthorized";
    if (!profile.emailConfirmed) return "unconfirmed";
    refresh();
    return "confirmed";
  } catch {
    return "unavailable";
  }
}

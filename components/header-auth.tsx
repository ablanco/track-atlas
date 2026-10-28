import { connection } from "next/server";
import { getLocale } from "next-intl/server";
import { getCurrentUser } from "@/auth/session";
import { AuthControl } from "./auth-control";
import { getAuthLabels } from "./auth-labels";

export async function HeaderAuth() {
  await connection();
  const locale = await getLocale();
  const labels = await getAuthLabels();
  let status: "guest" | "authenticated" | "unavailable";
  let userName = "";
  let admin = false;
  let userId: string | undefined;
  let avatarFileId: string | null = null;
  try {
    const user = await getCurrentUser();
    status = user ? "authenticated" : "guest";
    if (user) {
      admin = user.admin;
      userId = user.userId;
      userName =
        user.displayName?.trim() ||
        `${user.firstName} ${Array.from(user.lastName)[0]}.`;
      avatarFileId = user.avatarFileId;
    }
  } catch {
    status = "unavailable";
  }
  return (
    <AuthControl
      key={locale}
      status={status}
      admin={admin}
      userName={userName}
      userId={userId}
      avatarFileId={avatarFileId}
      locale={locale}
      labels={labels}
    />
  );
}

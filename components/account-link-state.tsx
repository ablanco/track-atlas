import { connection } from "next/server";
import { getLocale } from "next-intl/server";
import { getDb } from "@/db";
import { inspectAccountToken } from "@/auth/account-token-store";
import { readAccountLinkToken } from "@/auth/account-link-query";
import type { AccountEmailPurpose } from "@/email/types";
import { ConfirmationForm } from "@/app/[locale]/confirm-email/confirmation-form";
import { getCurrentUser } from "@/auth/session";
import { accountTokenCandidate } from "@/auth/account-token-store";
import { ResetForm } from "@/app/[locale]/reset-password/reset-form";
import { getAuthLabels } from "./auth-labels";
export async function AccountLinkState({ kind, searchParams }: { kind: AccountEmailPurpose; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const locale = await getLocale();
  const token = readAccountLinkToken(await searchParams);
  let status: "valid" | "already-confirmed" | "invalid" | "unavailable" = "invalid";
  try { if (token) status = await inspectAccountToken(getDb(), kind, token); } catch { status = "unavailable"; }
  if (kind === "email-confirmation") {
    let matchingUser = false;
    try { const current = await getCurrentUser(); const target = await accountTokenCandidate(getDb(),kind,token); matchingUser = !!current && current.userId === target?.id; } catch { /* No private navigation hint on lookup failure. */ }
    return <ConfirmationForm locale={locale} token={token} status={status} matchingUser={matchingUser} />;
  }
  return <ResetForm locale={locale} token={token} status={status} labels={await getAuthLabels()} />;
}

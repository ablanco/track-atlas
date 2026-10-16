import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { getSettingsProfile } from "@/auth/settings";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { redirect } from "@/i18n/navigation";
import { ProfileForm } from "./profile-form";
import { PasswordForm } from "./password-form";
import { DeactivateAccount } from "./deactivate-account";
import type { SettingsLabels } from "./settings-labels";
import { getEmailConfig } from "@/email/config";
import { readEmailCooldown, getEmailRateKey } from "@/auth/email-rate-limit";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings");
  return { title: `${t("title")} — Track Atlas`, description: t("description"), robots: { index: false, follow: false }, alternates: { languages: { en: "/en/settings", es: "/es/settings" } } };
}

async function AuthenticatedSettings() {
  await connection();
  const locale = await getLocale();
  const t = await getTranslations("Settings");
  let profile;
  try { profile = await getSettingsProfile(getDb(), (await cookies()).get(SESSION_COOKIE_NAME)?.value); }
  catch { return <p role="alert" className="mt-7 text-sm">{t("common.unavailable")}</p>; }
  if (!profile) return redirect({ href: "/", locale });
  let emailCooldown = 0;
  try { if (!profile.emailConfirmed) emailCooldown = await readEmailCooldown(getDb(), "email-confirmation", await getEmailRateKey(getDb(), profile.email, getEmailConfig().rateSecret)); } catch { /* Resend reports unavailable if configuration is incomplete. */ }
  const labels: SettingsLabels = {
    common: { check: t("common.check"), unavailable: t("common.unavailable"), unauthorized: t("common.unauthorized"), goHome: t("common.goHome"), close: t("common.close"), cancel: t("common.cancel"), optional: t("common.optional"), passwordTooLong: t("common.passwordTooLong"), errors: { required: t("common.errors.required"), invalid: t("common.errors.invalid"), tooLong: t("common.errors.tooLong"), mismatch: t("common.errors.mismatch") } },
    profile: { title: t("profile.title"), description: t("profile.description"), firstName: t("profile.firstName"), lastName: t("profile.lastName"), displayName: t("profile.displayName"), email: t("profile.email"), emailHint: t("profile.emailHint"), dateOfBirth: t("profile.dateOfBirth"), dateOfBirthHint: t("profile.dateOfBirthHint"), submit: t("profile.submit"), pending: t("profile.pending"), success: t("profile.success") },
    password: { title: t("password.title"), description: t("password.description"), password: t("password.password"), passwordConfirmation: t("password.passwordConfirmation"), hint: t("password.hint"), submit: t("password.submit"), pending: t("password.pending"), success: t("password.success"), confirmTitle: t("password.confirmTitle"), confirmDescription: t("password.confirmDescription") },
    deactivate: { title: t("deactivate.title"), description: t("deactivate.description"), submit: t("deactivate.submit"), pending: t("deactivate.pending"), confirmTitle: t("deactivate.confirmTitle"), confirmDescription: t("deactivate.confirmDescription"), completed: t("deactivate.completed") },
  };
  return <>
    <ProfileForm locale={locale} profile={profile} labels={labels.profile} common={labels.common} emailCooldown={emailCooldown} />
    <PasswordForm locale={locale} labels={labels.password} common={labels.common} />
    <DeactivateAccount locale={locale} labels={labels.deactivate} common={labels.common} />
  </>;
}

export default async function SettingsPage() {
  const t = await getTranslations("Settings");
  return <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
    <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
    <p className="mt-3 text-sm text-muted">{t("description")}</p>
    <Suspense fallback={<p role="status" className="mt-7 text-sm text-muted">{t("loading")}</p>}><AuthenticatedSettings /></Suspense>
  </main>;
}

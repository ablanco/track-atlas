import { Suspense } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Metadata } from "next";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { getSettingsProfile } from "@/auth/settings";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { redirect } from "@/i18n/navigation";
import { ProfileForm } from "./profile-form";
import { AvatarForm } from "./avatar-form";
import { PasswordForm } from "./password-form";
import { DeactivateAccount } from "./deactivate-account";
import type { SettingsLabels } from "./settings-labels";
import { getEmailConfig } from "@/email/config";
import { readEmailCooldown, getEmailRateKey } from "@/auth/email-rate-limit";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings");
  return {
    title: `${t("title")} — Track Atlas`,
    description: t("description"),
    robots: { index: false, follow: false },
    alternates: { languages: { en: "/en/settings", es: "/es/settings" } },
  };
}

async function AuthenticatedSettings() {
  await connection();
  const locale = await getLocale();
  const t = await getTranslations("Settings");
  let profile;
  try {
    profile = await getSettingsProfile(
      getDb(),
      (await cookies()).get(SESSION_COOKIE_NAME)?.value,
    );
  } catch {
    return (
      <Alert variant="destructive" className="mt-7">
        <AlertDescription>{t("common.unavailable")}</AlertDescription>
      </Alert>
    );
  }
  if (!profile) return redirect({ href: "/", locale });
  let emailCooldown = 0;
  try {
    if (!profile.emailConfirmed)
      emailCooldown = await readEmailCooldown(
        getDb(),
        "email-confirmation",
        await getEmailRateKey(
          getDb(),
          profile.email,
          getEmailConfig().rateSecret,
        ),
      );
  } catch {
    /* Resend reports unavailable if configuration is incomplete. */
  }
  const labels: SettingsLabels = {
    common: {
      check: t("common.check"),
      unavailable: t("common.unavailable"),
      unauthorized: t("common.unauthorized"),
      goHome: t("common.goHome"),
      close: t("common.close"),
      cancel: t("common.cancel"),
      optional: t("common.optional"),
      passwordTooLong: t("common.passwordTooLong"),
      errors: {
        required: t("common.errors.required"),
        invalid: t("common.errors.invalid"),
        tooLong: t("common.errors.tooLong"),
        mismatch: t("common.errors.mismatch"),
      },
    },
    profile: {
      title: t("profile.title"),
      description: t("profile.description"),
      firstName: t("profile.firstName"),
      lastName: t("profile.lastName"),
      displayName: t("profile.displayName"),
      email: t("profile.email"),
      emailHint: t("profile.emailHint"),
      dateOfBirth: t("profile.dateOfBirth"),
      dateOfBirthHint: t("profile.dateOfBirthHint"),
      submit: t("profile.submit"),
      pending: t("profile.pending"),
      success: t("profile.success"),
    },
    avatar: {
      title: t("avatar.title"),
      file: t("avatar.file"),
      optional: t("avatar.optional"),
      hint: t("avatar.hint"),
      remove: t("avatar.remove"),
      removing: t("avatar.removing"),
      removed: t("avatar.removed"),
      removeError: t("avatar.removeError"),
      empty: t("avatar.empty"),
      imageAlt: t("avatar.imageAlt"),
      imageUnavailable: t("avatar.imageUnavailable"),
      submit: t("avatar.submit"),
      pending: t("avatar.pending"),
      success: t("avatar.success"),
      errors: {
        invalidFile: t("avatar.errors.invalidFile"),
        tooLarge: t("avatar.errors.tooLarge"),
        quotaExceeded: t("avatar.errors.quotaExceeded"),
        unauthorized: t("avatar.errors.unauthorized"),
        unavailable: t("avatar.errors.unavailable"),
      },
    },
    password: {
      title: t("password.title"),
      description: t("password.description"),
      password: t("password.password"),
      passwordConfirmation: t("password.passwordConfirmation"),
      hint: t("password.hint"),
      submit: t("password.submit"),
      pending: t("password.pending"),
      success: t("password.success"),
      confirmTitle: t("password.confirmTitle"),
      confirmDescription: t("password.confirmDescription"),
    },
    deactivate: {
      title: t("deactivate.title"),
      description: t("deactivate.description"),
      submit: t("deactivate.submit"),
      pending: t("deactivate.pending"),
      confirmTitle: t("deactivate.confirmTitle"),
      confirmDescription: t("deactivate.confirmDescription"),
      completed: t("deactivate.completed"),
    },
  };
  return (
    <>
      <ProfileForm
        locale={locale}
        profile={profile}
        labels={labels.profile}
        common={labels.common}
        emailCooldown={emailCooldown}
      />
      <AvatarForm
        avatarFileId={profile.avatarFileId}
        avatarHasVersions={profile.avatarHasVersions}
        labels={labels.avatar}
      />
      <PasswordForm
        locale={locale}
        labels={labels.password}
        common={labels.common}
      />
      <DeactivateAccount
        locale={locale}
        labels={labels.deactivate}
        common={labels.common}
      />
    </>
  );
}

export default async function SettingsPage() {
  const t = await getTranslations("Settings");
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-2xl flex-1 px-5 py-12 sm:px-8 sm:py-16"
    >
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{t("description")}</p>
      <Suspense
        fallback={
          <p role="status" className="mt-7 text-sm text-muted-foreground">
            {t("loading")}
          </p>
        }
      >
        <AuthenticatedSettings />
      </Suspense>
    </main>
  );
}

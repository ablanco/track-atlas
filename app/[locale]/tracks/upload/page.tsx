import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { getSettingsProfile } from "@/auth/settings";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { Link } from "@/i18n/navigation";
import { UploadLogin } from "@/components/upload-login";
import { getAuthLabels } from "@/components/auth-labels";
import { EmailConfirmation } from "@/app/[locale]/settings/email-confirmation";
import { getEmailConfig } from "@/email/config";
import { readEmailCooldown, getEmailRateKey } from "@/auth/email-rate-limit";
import { UploadForm } from "./upload-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Tracks");
  return {
    title: `${t("title")} — Track Atlas`,
    robots: { index: false, follow: false },
  };
}
async function EligibleUpload() {
  await connection();
  const t = await getTranslations("Tracks");
  let profile;
  try {
    profile = await getSettingsProfile(
      getDb(),
      (await cookies()).get(SESSION_COOKIE_NAME)?.value,
    );
  } catch {
    return (
      <p role="alert" className="mt-7 text-destructive">
        {t("errors.unavailable")}
      </p>
    );
  }
  if (!profile)
    return (
      <div className="mt-7 space-y-4">
        <p>{t("guest")}</p>
        <UploadLogin
          locale={await getLocale()}
          labels={await getAuthLabels()}
        />
        <Link
          className="inline-block py-3 underline underline-offset-4"
          href="/signup?intent=upload"
        >
          {t("signup")}
        </Link>
      </div>
    );
  if (!profile.emailConfirmed) {
    let cooldown = 0;
    try {
      cooldown = await readEmailCooldown(
        getDb(),
        "email-confirmation",
        await getEmailRateKey(
          getDb(),
          profile.email,
          getEmailConfig().rateSecret,
        ),
      );
    } catch {
      /* The resend action still enforces server-side limits. */
    }
    return (
      <div className="mt-7 space-y-4">
        <p>{t("unconfirmed")}</p>
        <EmailConfirmation
          locale={await getLocale()}
          initialCooldownSeconds={cooldown}
        />
        <Link
          href="/tracks/upload"
          className="inline-block py-3 underline underline-offset-4"
        >
          {t("checkConfirmation")}
        </Link>
        <Link
          className="inline-block py-3 underline underline-offset-4"
          href="/settings"
        >
          {t("settings")}
        </Link>
      </div>
    );
  }
  return <UploadForm />;
}
export default async function UploadPage() {
  const t = await getTranslations("Tracks");
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-2xl flex-1 px-5 py-12 sm:px-8 sm:py-16"
    >
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{t("intro")}</p>
      <Suspense
        fallback={
          <p role="status" className="mt-7">
            {t("loading")}
          </p>
        }
      >
        <EligibleUpload />
      </Suspense>
    </main>
  );
}

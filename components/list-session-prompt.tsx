"use client";
import { useLocale, useTranslations } from "next-intl";
import { AccountAccessButton } from "./account-access-button";
import type { AuthLabels } from "./auth-control";
export function ListSessionPrompt({ labels }: { labels: AuthLabels }) {
  const locale = useLocale(),
    t = useTranslations("Lists");
  return (
    <div className="p-6">
      <p>{t("signIn")}</p>
      <AccountAccessButton
        locale={locale}
        initialView="login"
        labels={labels}
      />
    </div>
  );
}

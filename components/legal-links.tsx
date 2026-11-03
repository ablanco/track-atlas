"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function LegalLinks() {
  const t = useTranslations("Legal");
  return (
    <nav
      aria-label={t("menu")}
      className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
    >
      <Link
        className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        href="/legal/terms"
      >
        {t("terms")}
      </Link>
      <Link
        className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        href="/legal/privacy"
      >
        {t("privacy")}
      </Link>
    </nav>
  );
}

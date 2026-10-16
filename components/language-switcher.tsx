"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { Suspense } from "react";
import { AccountLinkLanguageLinks } from "./account-link-language-links";

export function LanguageSwitcher({ locale, label }: { locale: string; label: string }) {
  const pathname = usePathname();
  if (pathname === "/confirm-email" || pathname === "/reset-password") return <Suspense fallback={<span className="text-sm">{label}</span>}><AccountLinkLanguageLinks locale={locale} label={label} /></Suspense>;
  return (
    <nav aria-label={label} className="flex gap-3 text-sm">
      {routing.locales.map((language) => (
        <Link key={language} href={pathname} locale={language} lang={language} hrefLang={language}
          aria-current={language === locale ? "page" : undefined}
          className={language === locale ? "font-semibold underline decoration-accent underline-offset-4" : "text-muted hover:underline underline-offset-4"}>
          {language === "en" ? "English" : "Español"}
        </Link>
      ))}
    </nav>
  );
}

"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export function LanguageSwitcher({ locale, label }: { locale: string; label: string }) {
  const pathname = usePathname();
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

"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { buttonVariants } from "@/components/ui/button";
import { Suspense } from "react";
import { AccountLinkLanguageLinks } from "./account-link-language-links";

export function LanguageSwitcher({
  locale,
  label,
}: {
  locale: string;
  label: string;
}) {
  const pathname = usePathname();
  if (pathname === "/confirm-email" || pathname === "/reset-password")
    return (
      <Suspense fallback={<span className="text-sm">{label}</span>}>
        <AccountLinkLanguageLinks locale={locale} label={label} />
      </Suspense>
    );
  return (
    <nav aria-label={label} className="flex gap-1 text-sm">
      {routing.locales.map((language) => (
        <Link
          key={language}
          href={pathname}
          locale={language}
          lang={language}
          hrefLang={language}
          aria-current={language === locale ? "page" : undefined}
          className={buttonVariants({
            variant: language === locale ? "secondary" : "ghost",
            size: "sm",
            className: "min-h-11 px-2",
          })}
        >
          {language === "en" ? "English" : "Español"}
        </Link>
      ))}
    </nav>
  );
}

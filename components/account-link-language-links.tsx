"use client";
import { useSearchParams } from "next/navigation";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { readAccountLinkToken } from "@/auth/account-link-query";
export function AccountLinkLanguageLinks({ locale, label }: { locale: string; label: string }) {
  const pathname = usePathname(), query = useSearchParams();
  const tokens = query.getAll("token");
  const token = readAccountLinkToken({ token: tokens.length === 1 ? tokens[0] : tokens });
  return <nav aria-label={label} className="flex gap-3 text-sm">{routing.locales.map(language =>
    <Link key={language} href={token ? { pathname, query: { token } } : pathname} prefetch={false} locale={language} lang={language} hrefLang={language} aria-current={language === locale ? "page" : undefined} className={language === locale ? "font-semibold underline decoration-accent underline-offset-4" : "text-muted hover:underline underline-offset-4"}>{language === "en" ? "English" : "Español"}</Link>
  )}</nav>;
}

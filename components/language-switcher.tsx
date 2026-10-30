"use client";

import { usePathname } from "@/i18n/navigation";
import { LanguageSelect } from "./language-select";
import { useSearchParams } from "next/navigation";
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
  const search = useSearchParams();
  const preserveQuery =
    pathname === "/tracks" ||
    pathname === "/signup" ||
    pathname === "/tracks/upload" ||
    /^\/lists\/[^/]+$/.test(pathname) ||
    /^\/users\/[^/]+\/tracks$/.test(pathname);
  if (pathname === "/confirm-email" || pathname === "/reset-password")
    return (
      <Suspense fallback={<span className="text-sm">{label}</span>}>
        <AccountLinkLanguageLinks locale={locale} label={label} />
      </Suspense>
    );
  return (
    <LanguageSelect
      locale={locale}
      label={label}
      href={preserveQuery && search.size ? `${pathname}?${search}` : pathname}
    />
  );
}

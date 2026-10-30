"use client";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { LanguageSelect } from "./language-select";
import { readAccountLinkToken } from "@/auth/account-link-query";
export function AccountLinkLanguageLinks({
  locale,
  label,
}: {
  locale: string;
  label: string;
}) {
  const pathname = usePathname(),
    query = useSearchParams();
  const tokens = query.getAll("token");
  const token = readAccountLinkToken({
    token: tokens.length === 1 ? tokens[0] : tokens,
  });
  return (
    <LanguageSelect
      locale={locale}
      label={label}
      href={token ? `${pathname}?${new URLSearchParams({ token })}` : pathname}
    />
  );
}

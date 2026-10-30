"use client";

import { FlagIcon } from "@phosphor-icons/react/dist/csr/Flag";
import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { languageNames } from "@/i18n/languages";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LanguageSelect({
  locale,
  label,
  href,
}: {
  locale: string;
  label: string;
  href: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      value={locale}
      disabled={pending}
      items={routing.locales.map((value) => ({
        value,
        label: languageNames[value],
      }))}
      onValueChange={(language) => {
        const supported = routing.locales.find((value) => value === language);
        if (!supported || supported === locale) return;
        startTransition(() => {
          router.push(href, { locale: supported, scroll: false });
        });
      }}
    >
      <SelectTrigger aria-label={label} className="min-h-11">
        <FlagIcon aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {routing.locales.map((language) => (
          <SelectItem key={language} value={language} lang={language}>
            {languageNames[language]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

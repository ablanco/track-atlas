import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { GithubLogoIcon } from "@phosphor-icons/react/dist/ssr/GithubLogo";
import { LegalLinks } from "./legal-links";
import { ThemeSwitcher } from "./theme-switcher";
import { LanguageSwitcher } from "./language-switcher";

export async function FooterControls({
  locale,
  externalGithub = false,
}: {
  locale: string;
  externalGithub?: boolean;
}) {
  const t = await getTranslations("Theme");
  const nav = await getTranslations("Navigation");
  return (
    <>
      <LegalLinks />
      <a
        href="https://github.com/ablanco/track-atlas"
        target={externalGithub ? "_blank" : undefined}
        rel={externalGithub ? "noopener noreferrer" : undefined}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm underline-offset-4 hover:underline"
      >
        <GithubLogoIcon
          size={16}
          weight="regular"
          aria-hidden="true"
          className="shrink-0"
        />
        GitHub
      </a>
      <ThemeSwitcher
        labels={{ label: t("label"), light: t("light"), dark: t("dark") }}
      />
      <Suspense
        fallback={
          <span className="inline-flex min-h-11 items-center text-sm text-muted-foreground">
            {nav("language")}
          </span>
        }
      >
        <LanguageSwitcher locale={locale} label={nav("language")} />
      </Suspense>
    </>
  );
}

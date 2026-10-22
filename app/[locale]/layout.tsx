import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { HeaderAuth } from "@/components/header-auth";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import * as rootParams from "next/root-params";
import { routing } from "@/i18n/routing";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LanguageSwitcher } from "@/components/language-switcher";
import { GithubLogoIcon } from "@phosphor-icons/react/dist/ssr/GithubLogo";
import { MapPinAreaIcon } from "@phosphor-icons/react/dist/ssr/MapPinArea";
import { Link } from "@/i18n/navigation";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
}: LayoutProps<"/[locale]">) {
  const locale = await rootParams.locale();
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations("Theme");
  const nav = await getTranslations("Navigation");
  const auth = await getTranslations("Auth");

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full min-h-full flex flex-col">
        <ThemeProvider>
          <NextIntlClientProvider>
            <a
              href="#main-content"
              className="sr-only z-50 rounded-md bg-card px-4 py-3 text-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
            >
              {nav("skip")}
            </a>
            <header className="shrink-0 mx-auto flex w-full flex-wrap items-center justify-between gap-x-8 gap-y-5 border-b border-border px-5 py-6 sm:px-8">
              <Link
                href="/"
                aria-label={nav("home")}
                className="inline-flex items-center gap-2 text-xl font-extrabold tracking-tight"
              >
                <MapPinAreaIcon
                  size={24}
                  weight="regular"
                  aria-hidden="true"
                  focusable="false"
                  className="shrink-0 text-foreground"
                />
                Track Atlas
              </Link>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link
                  href="/tracks"
                  className="inline-flex min-h-11 items-center text-sm hover:underline"
                >
                  {nav("explore")}
                </Link>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <Suspense
                    fallback={
                      <span className="inline-flex min-h-11 items-center text-sm text-muted-foreground">
                        {nav("language")}
                      </span>
                    }
                  >
                    <LanguageSwitcher locale={locale} label={nav("language")} />
                  </Suspense>
                  <a
                    href="https://github.com/ablanco/track-atlas"
                    className="inline-flex min-h-11 items-center gap-1.5 text-sm hover:underline underline-offset-4"
                  >
                    <GithubLogoIcon
                      size={16}
                      weight="regular"
                      aria-hidden="true"
                      focusable="false"
                      className="shrink-0"
                    />
                    GitHub
                  </a>
                </div>
                <ThemeSwitcher
                  labels={{
                    label: t("label"),
                    light: t("light"),
                    dark: t("dark"),
                  }}
                />
                <Suspense
                  fallback={
                    <span
                      role="status"
                      className="text-xs text-muted-foreground"
                    >
                      {auth("loading")}
                    </span>
                  }
                >
                  <HeaderAuth />
                </Suspense>
              </div>
            </header>
            {children}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

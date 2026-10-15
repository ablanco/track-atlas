import { Geist, Geist_Mono } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import * as rootParams from "next/root-params";
import { routing } from "@/i18n/routing";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeSwitcher } from "@/components/theme-switcher";
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

export default async function RootLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await rootParams.locale();
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations("Theme");
  const nav = await getTranslations("Navigation");

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <NextIntlClientProvider>
            <a href="#main-content" className="sr-only z-50 rounded-md bg-surface px-4 py-3 text-accent focus:not-sr-only focus:fixed focus:top-4 focus:left-4">
              {nav("skip")}
            </a>
            <header className="mx-auto flex w-full max-w-content flex-wrap items-center justify-between gap-x-8 gap-y-5 border-b border-default px-5 py-6 sm:px-8">
              <Link href="/" aria-label={nav("home")} className="text-xl font-extrabold tracking-tight">
                <span aria-hidden="true" className="mr-2 text-accent">↗</span>Track Atlas
              </Link>
              <nav aria-label={nav("main")} className="order-3 flex w-full flex-wrap gap-x-6 gap-y-2 text-sm lg:order-none lg:w-auto">
                <a href="#discover" className="hover:underline underline-offset-4">{nav("discover")}</a>
                <a href="#how-it-works" className="hover:underline underline-offset-4">{nav("how")}</a>
                <a href="https://github.com/ablanco/track-atlas" className="hover:underline underline-offset-4">GitHub <span aria-hidden="true">↗</span></a>
              </nav>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <nav aria-label={nav("language")} className="flex gap-3 text-sm">
                  {routing.locales.map((language) => (
                    <Link key={language} href="/" locale={language} lang={language} hrefLang={language}
                      aria-current={language === locale ? "page" : undefined}
                      className={language === locale ? "font-semibold underline decoration-accent underline-offset-4" : "text-muted hover:underline underline-offset-4"}>
                      {language === "en" ? "English" : "Español"}
                    </Link>
                  ))}
                </nav>
                <ThemeSwitcher
                  labels={{
                    label: t("label"),
                    light: t("light"),
                    dark: t("dark"),
                    system: t("system"),
                  }}
                />
              </div>
            </header>
            {children}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

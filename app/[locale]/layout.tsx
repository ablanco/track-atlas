import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { PageFooter } from "@/components/page-footer";
import { HeaderAuth } from "@/components/header-auth";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import * as rootParams from "next/root-params";
import { routing } from "@/i18n/routing";
import { Toaster } from "@/components/ui/toast";
import { ThemeProvider } from "@/components/theme-provider";
import { FooterControls } from "@/components/footer-controls";
import { ExplorerFooter } from "@/components/explorer-footer";
import { SiteHeader } from "@/components/site-header";
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
            <SiteHeader>
              <Suspense
                fallback={
                  <span role="status" className="text-xs text-muted-foreground">
                    {auth("loading")}
                  </span>
                }
              >
                <HeaderAuth />
              </Suspense>
            </SiteHeader>
            {/* Keep overlay markers on a stable shell while page content streams. */}
            <div data-page-content className="contents">
              {children}
            </div>
            <PageFooter>
              <FooterControls locale={locale} />
            </PageFooter>
            <ExplorerFooter key={locale}>
              <FooterControls locale={locale} externalGithub />
            </ExplorerFooter>
            <Toaster />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

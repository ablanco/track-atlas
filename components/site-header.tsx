"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LegalLinks } from "./legal-links";
import { BrandMark } from "./brand-mark";
import type { ReactNode } from "react";
import styles from "./site-header.module.css";

export function SiteHeader({ children }: { children: ReactNode }) {
  const legal = useTranslations("Legal");
  const nav = useTranslations("Navigation");
  const t = useTranslations("Home");
  return (
    <header className={styles.header}>
      <Link
        href="/"
        aria-label={nav("home")}
        className="inline-flex items-center gap-2 text-xl font-extrabold tracking-tight"
      >
        <BrandMark />
        Track Atlas
      </Link>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <>
          <nav aria-label={t("menu")} className={styles.desktop}>
            <a href="#map-search">{t("navSearch")}</a>
            <a href="#activities">{t("navActivities")}</a>
          </nav>
          <details suppressHydrationWarning className={styles.mobile}>
            <summary>{t("menu")}</summary>
            <nav aria-label={t("menu")}>
              <a
                href="#map-search"
                onClick={(e) =>
                  e.currentTarget.closest("details")?.removeAttribute("open")
                }
              >
                {t("navSearch")}
              </a>
              <a
                href="#activities"
                onClick={(e) =>
                  e.currentTarget.closest("details")?.removeAttribute("open")
                }
              >
                {t("navActivities")}
              </a>
            </nav>
          </details>
        </>
        <Link
          href="/tracks"
          className="inline-flex min-h-11 items-center text-sm hover:underline"
        >
          {nav("explore")}
        </Link>
        <details
          // Native toggling can precede hydration; retain the browser's open state.
          suppressHydrationWarning
          className={styles.legal}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a"))
              event.currentTarget.open = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary>{legal("menu")}</summary>
          <LegalLinks />
        </details>
        {children}
      </div>
    </header>
  );
}

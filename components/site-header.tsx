"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { BrandMark } from "./brand-mark";
import type { ReactNode } from "react";
import styles from "./site-header.module.css";

export function SiteHeader({ children }: { children: ReactNode }) {
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
          <details className={styles.mobile}>
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
        {children}
      </div>
    </header>
  );
}

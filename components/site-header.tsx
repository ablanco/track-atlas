"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { BrandMark } from "./brand-mark";
import { useSyncExternalStore, type ReactNode } from "react";
import styles from "./site-header.module.css";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function SiteHeader({ children }: { children: ReactNode }) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
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
        <NavigationMenu aria-label={t("menu")}>
          <NavigationMenuList className="flex-wrap">
            <NavigationMenuItem className={styles.desktop}>
              <NavigationMenuLink href="#map-search" className={styles.topLink}>
                {t("navSearch")}
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem className={styles.desktop}>
              <NavigationMenuLink href="#activities" className={styles.topLink}>
                {t("navActivities")}
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem className={styles.mobile}>
              <NavigationMenuTrigger
                disabled={!ready}
                className={styles.topLink}
              >
                {t("menu")}
              </NavigationMenuTrigger>
              <NavigationMenuContent className="w-max min-w-44">
                <NavigationMenuLink
                  closeOnClick
                  href="#map-search"
                  className="min-h-11"
                >
                  {t("navSearch")}
                </NavigationMenuLink>
                <NavigationMenuLink
                  closeOnClick
                  href="#activities"
                  className="min-h-11"
                >
                  {t("navActivities")}
                </NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink
                render={<Link href="/tracks" />}
                className={styles.topLink}
              >
                {nav("explore")}
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuTrigger
                disabled={!ready}
                className={styles.topLink}
              >
                {legal("menu")}
              </NavigationMenuTrigger>
              <NavigationMenuContent className="w-max min-w-52">
                <NavigationMenuLink
                  closeOnClick
                  render={<Link href="/legal/terms" />}
                  className="min-h-11"
                >
                  {legal("terms")}
                </NavigationMenuLink>
                <NavigationMenuLink
                  closeOnClick
                  render={<Link href="/legal/privacy" />}
                  className="min-h-11"
                >
                  {legal("privacy")}
                </NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
        {children}
      </div>
    </header>
  );
}

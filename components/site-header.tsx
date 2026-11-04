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
        <NavigationMenu aria-label={nav("menu")}>
          <NavigationMenuList className="flex-wrap">
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

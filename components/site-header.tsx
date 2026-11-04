"use client";
import { useTranslations } from "next-intl";
import { CompassIcon } from "@phosphor-icons/react/dist/csr/Compass";
import { Link } from "@/i18n/navigation";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";
import { BrandMark } from "./brand-mark";
import type { ReactNode } from "react";
import styles from "./site-header.module.css";

export function SiteHeader({ children }: { children: ReactNode }) {
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
                <CompassIcon aria-hidden="true" className="size-4 shrink-0" />
                {nav("explore")}
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
        {children}
      </div>
    </header>
  );
}

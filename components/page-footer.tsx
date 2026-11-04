import { getTranslations } from "next-intl/server";
import { BrandMark } from "./brand-mark";
import type { ReactNode } from "react";
import styles from "./page-footer.module.css";

/** A stable server shell avoids pathname-dependent markup during streamed hydration. */
export async function PageFooter({ children }: { children: ReactNode }) {
  const t = await getTranslations("Home");
  return (
    <footer className={styles.footer}>
      <div className={styles.brand}>
        <div className="flex items-center gap-2 text-xl font-bold">
          <BrandMark />
          Track Atlas
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{t("footer")}</p>
        <p className="mt-2 text-xs text-muted-foreground">{t("status")}</p>
      </div>
      <div className={styles.controls}>{children}</div>
    </footer>
  );
}

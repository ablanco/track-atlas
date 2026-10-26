"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

export function ExploreMapFailure({ controls }: { controls?: ReactNode }) {
  const t = useTranslations("ExploreMap");
  return (
    <div role="alert" className="space-y-2 p-4 text-sm text-muted-foreground">
      {controls}
      <p>{t("failure")}</p>
      <button
        type="button"
        className="min-h-11 underline"
        onClick={() => window.location.reload()}
      >
        {t("reload")}
      </button>
    </div>
  );
}

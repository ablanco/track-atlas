"use client";

import { useTranslations } from "next-intl";

export function MapLoading() {
  const t = useTranslations("Tracks.map");
  return <p role="status">{t("loading")}</p>;
}

export function MapFailure() {
  const t = useTranslations("Tracks.map");
  return (
    <div role="alert" className="space-y-2 text-sm text-muted-foreground">
      <p>{t("failure")}</p>
      <button
        type="button"
        className="min-h-11 underline"
        onClick={() => window.location.reload()}
      >
        {t("retry")}
      </button>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export function AdminPhotoPreview({ id }: { id: string }) {
  const t = useTranslations("Admin");
  const [failed, setFailed] = useState(false);
  return (
    <figure className="space-y-2 rounded-xl border bg-card p-5">
      <figcaption className="text-sm font-medium">
        {t("photoPreview")}
      </figcaption>
      {failed ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("photoPreviewUnavailable")}
        </p>
      ) : (
        // Keep authenticated image requests out of the shared image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/admin/photos/${encodeURIComponent(id)}/preview`}
          alt={t("photoPreview")}
          className="max-h-96 max-w-full rounded-lg object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </figure>
  );
}

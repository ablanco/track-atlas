"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/toast";
import { checkUploadConfirmation } from "./confirmation-action";

export function ConfirmationCheck() {
  const t = useTranslations("Tracks");
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="cursor-pointer py-3 text-left underline underline-offset-4 disabled:cursor-wait disabled:opacity-50"
      onClick={() => {
        startTransition(async () => {
          try {
            const result = await checkUploadConfirmation();
            if (result !== "confirmed") {
              toast.add({
                title:
                  result === "unconfirmed"
                    ? t("stillUnconfirmed")
                    : t(`errors.${result}`),
                type: result === "unconfirmed" ? "info" : "error",
              });
            }
          } catch {
            toast.add({ title: t("errors.unavailable"), type: "error" });
          }
        });
      }}
    >
      {t("checkConfirmation")}
    </button>
  );
}

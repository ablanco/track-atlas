"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import type { LegalAcceptanceInput } from "@/legal/acceptance-input";
import { acceptLegal } from "./actions";
export function AcceptanceForm({
  locale,
  returnTo,
  versions,
}: {
  locale: string;
  returnTo: string;
  versions: Pick<LegalAcceptanceInput, "termsVersion" | "privacyVersion">;
}) {
  const t = useTranslations("LegalRenewal");
  const [error, action, pending] = useActionState(
    acceptLegal.bind(null, locale, returnTo),
    "",
  );
  return (
    <form action={action} className="mt-6 space-y-6">
      {(
        [
          ["termsAccepted", "termsVersion", "terms"],
          ["privacyAcknowledged", "privacyVersion", "privacy"],
        ] as const
      ).map(([name, field, document]) => (
        <div key={name}>
          <input type="hidden" name={field} value={versions[field]} />
          <label className="flex items-start gap-3">
            <input
              className="mt-1 size-5 accent-primary"
              type="checkbox"
              name={name}
              required
              value="on"
            />
            <span>
              {t.rich(name, {
                document: (chunks) => (
                  <Link
                    className="underline"
                    href={`/legal/${document}/${versions[field]}`}
                    target="_blank"
                    rel="noopener"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          </label>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-destructive">
          {t(error as "invalid" | "unauthorized" | "unavailable")}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {t(pending ? "pending" : "submit")}
      </Button>
    </form>
  );
}

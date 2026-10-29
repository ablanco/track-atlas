"use client";

import { Alert } from "@/components/ui/alert";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { confirmEmailLink } from "../email-actions";
import type { ConfirmLinkActionState } from "@/auth/account-email-action";
export type LinkStatus =
  "valid" | "already-confirmed" | "invalid" | "unavailable";
export function ConfirmationForm({
  locale,
  token,
  status,
  matchingUser,
  uploadIntent = false,
}: {
  locale: string;
  token: string | null;
  status: LinkStatus;
  matchingUser: boolean;
  uploadIntent?: boolean;
}) {
  const t = useTranslations("AccountEmails.ui");
  // Confirmation refresh consumes the token, so retain the initial navigation hint.
  // This only chooses a link; the destination reauthorizes every request.
  const [initialMatchingUser] = useState(matchingUser);
  const showAccountLink = matchingUser || initialMatchingUser;
  const [state, action, pending] = useActionState(
    confirmEmailLink.bind(null, locale),
    {} as ConfirmLinkActionState,
  );
  const result = useRef<HTMLHeadingElement>(null);
  const attempted = useRef<string | null>(null);
  useEffect(() => {
    if (
      status !== "valid" ||
      !token ||
      state.confirmed ||
      attempted.current === token
    )
      return;
    // The email click is the user's confirmation. Submit automatically after
    // hydration, not during a potentially prerendered/prefetched server render.
    // The ref also prevents duplicate submissions under Strict Mode effects.
    attempted.current = token;
    const form = new FormData();
    form.set("token", token);
    startTransition(() => action(form));
  }, [status, token, state.confirmed, action]);
  useEffect(() => {
    if (state.confirmed) {
      window.history.replaceState(null, "", window.location.pathname);
      result.current?.focus();
    }
  }, [state]);
  const completed = state.confirmed || status === "already-confirmed";
  const error =
    state.formError ??
    (status === "invalid" || status === "unavailable" ? status : null);
  const confirming = !completed && !error;
  return (
    <section aria-busy={pending || confirming}>
      <h1 ref={result} tabIndex={-1} className="text-3xl font-semibold">
        {t(
          state.confirmed
            ? "confirmedTitle"
            : status === "already-confirmed"
              ? "alreadyConfirmed"
              : error === "unavailable"
                ? "unavailable"
                : error === "invalid"
                  ? "invalidTitle"
                  : "confirmingTitle",
        )}
      </h1>
      <Alert
        role={completed || confirming ? "status" : "alert"}
        variant={error ? "destructive" : "default"}
        className="mt-4"
      >
        {t(
          completed
            ? "confirmedDescription"
            : confirming
              ? "confirmingDescription"
              : error === "unavailable"
                ? "unavailable"
                : "invalidDescription",
        )}
      </Alert>
      <Link
        href={
          completed && showAccountLink
            ? uploadIntent
              ? "/tracks/upload"
              : "/settings"
            : "/"
        }
        className="mt-6 inline-block text-primary underline underline-offset-4"
      >
        {t(
          completed && showAccountLink
            ? uploadIntent
              ? "continueUpload"
              : "settings"
            : "home",
        )}
      </Link>
    </section>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { resendEmailConfirmation } from "../email-actions";
import type { ConfirmationActionState } from "@/auth/account-email-action";
export function EmailConfirmation({
  locale,
  initialCooldownSeconds,
}: {
  locale: string;
  initialCooldownSeconds: number;
}) {
  const t = useTranslations("AccountEmails.ui");
  const [state, action, pending] = useActionState(
    resendEmailConfirmation.bind(null, locale),
    {} as ConfirmationActionState,
  );
  const [remaining, setRemaining] = useState(initialCooldownSeconds);
  const message = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.retryAfterSeconds !== undefined) {
      const end = Date.now() + state.retryAfterSeconds * 1000;
      const update = () =>
        setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
      update();
      const timer = setInterval(update, 1000);
      return () => clearInterval(timer);
    }
  }, [state]);
  useEffect(() => {
    if (state.success || state.formError) message.current?.focus();
  }, [state]);
  useEffect(() => {
    if (state.retryAfterSeconds !== undefined || initialCooldownSeconds <= 0)
      return;
    const end = Date.now() + initialCooldownSeconds * 1000;
    const timer = setInterval(
      () => setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000))),
      1000,
    );
    return () => clearInterval(timer);
  }, [initialCooldownSeconds, state]);
  return (
    <div className="mt-4 rounded-md bg-muted p-4">
      <span className="inline-block rounded-full border border-border px-3 py-1 text-xs font-semibold">
        {t("notConfirmed")}
      </span>
      <p className="mt-3 text-sm text-muted-foreground">
        {t("statusDescription")}
      </p>
      <Button
        type="button"
        disabled={pending || remaining > 0}
        onClick={() => startTransition(() => action(new FormData()))}
        variant="outline"
        className="mt-4 min-h-11"
      >
        {t(pending ? "pending" : "resend")}
      </Button>
      {(state.success || state.formError) && (
        <Alert
          ref={message}
          tabIndex={-1}
          role={state.formError ? "alert" : "status"}
          variant={state.formError ? "destructive" : "default"}
          className="mt-3"
        >
          {t(state.formError ?? "requested")}
        </Alert>
      )}
      {remaining > 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("cooldown", { seconds: remaining })}
        </p>
      )}
    </div>
  );
}

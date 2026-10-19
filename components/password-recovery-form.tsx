"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useActionState, useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { requestPasswordResetEmail } from "@/app/[locale]/email-actions";
import type { RecoveryActionState } from "@/auth/account-email-action";
export function PasswordRecoveryForm({
  locale,
  email,
  titleId,
  descriptionId,
  onPendingChange,
  onBack,
}: {
  locale: string;
  email: string;
  titleId: string;
  descriptionId: string;
  onPendingChange(pending: boolean): void;
  onBack(email: string): void;
}) {
  const t = useTranslations("AccountEmails.ui"),
    id = useId(),
    form = useRef<HTMLFormElement>(null),
    feedback = useRef<HTMLDivElement>(null);
  const [state, action, pending] = useActionState(
    requestPasswordResetEmail.bind(null, locale),
    { values: { email }, fieldErrors: {} } as RecoveryActionState,
  );
  useEffect(() => {
    onPendingChange(pending);
  }, [pending, onPendingChange]);
  useEffect(() => {
    if (state.requested || state.formError || state.fieldErrors.email)
      feedback.current?.focus();
  }, [state]);
  useEffect(() => {
    form.current?.querySelector("input")?.focus();
  }, []);
  return (
    <>
      <DialogTitle id={titleId} className="pr-10 text-2xl font-semibold">
        {t(state.requested ? "checkEmail" : "recoveryTitle")}
      </DialogTitle>
      <DialogDescription
        id={descriptionId}
        className="mt-2 text-sm text-muted-foreground"
      >
        {t(state.requested ? "checkSpam" : "recoveryDescription")}
      </DialogDescription>
      {state.requested ? (
        <Alert ref={feedback} role="status" tabIndex={-1} className="mt-6">
          {t("genericResponse")}
        </Alert>
      ) : (
        <form
          ref={form}
          action={action}
          noValidate
          className="mt-6 space-y-5"
          aria-busy={pending}
        >
          {(state.formError || state.fieldErrors.email) && (
            <Alert
              ref={feedback}
              role="alert"
              tabIndex={-1}
              variant="destructive"
            >
              {t(state.formError ?? "check")}
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor={`${id}-email`}>{t("email")}</FieldLabel>
            <Input
              id={`${id}-email`}
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              defaultValue={state.values.email}
              disabled={pending}
              aria-invalid={!!state.fieldErrors.email || undefined}
              aria-describedby={
                state.fieldErrors.email ? `${id}-error` : undefined
              }
              className="min-h-11"
            />
            {state.fieldErrors.email && (
              <FieldError id={`${id}-error`}>
                {t(state.fieldErrors.email)}
              </FieldError>
            )}
          </Field>
          <Button type="submit" disabled={pending} className="min-h-11 w-full">
            {t(pending ? "pending" : "sendReset")}
          </Button>
        </form>
      )}
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          const input = form.current?.elements.namedItem("email");
          onBack(
            input instanceof HTMLInputElement
              ? input.value.slice(0, 254)
              : state.values.email,
          );
        }}
        variant="link"
        className="mt-5 min-h-11 w-full"
      >
        {t("backLogin")}
      </Button>
    </>
  );
}

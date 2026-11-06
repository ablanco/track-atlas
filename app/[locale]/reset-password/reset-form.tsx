"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { useActionState, useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { resetPasswordFromLink } from "../email-actions";
import type { ResetLinkActionState } from "@/auth/account-email-action";
import { AccountAccessButton } from "@/components/account-access-button";
import { PasswordInput } from "@/components/password-input";
import { NewPasswordInput } from "@/components/new-password-input";
import { validatePassword } from "@/auth/settings-validation";
import { passwordStrengthError } from "@/auth/password-strength";
import type { AuthLabels } from "@/components/auth-control";
import type { LinkStatus } from "../confirm-email/confirmation-form";
export function ResetForm({
  locale,
  token,
  status,
  labels,
}: {
  locale: string;
  token: string | null;
  status: LinkStatus;
  labels: AuthLabels;
}) {
  const t = useTranslations("AccountEmails.ui"),
    id = useId(),
    form = useRef<HTMLFormElement>(null),
    feedback = useRef<HTMLDivElement>(null),
    title = useRef<HTMLHeadingElement>(null);
  const [state, action, pending] = useActionState(
    async (
      previous: ResetLinkActionState,
      submitted: FormData,
    ): Promise<ResetLinkActionState> => {
      const parsed = validatePassword(submitted);
      if (parsed.ok) {
        try {
          const error = await passwordStrengthError(parsed.input.password);
          if (error) return { fieldErrors: { password: error } };
        } catch {
          return { fieldErrors: {}, formError: "unavailable" };
        }
      }
      return resetPasswordFromLink(locale, previous, submitted);
    },
    { fieldErrors: {} } as ResetLinkActionState,
  );
  useEffect(() => {
    if (state.completed) {
      window.history.replaceState(null, "", window.location.pathname);
      title.current?.focus();
    }
    if (state.formError || Object.keys(state.fieldErrors).length)
      feedback.current?.focus();
    if (
      state.completed ||
      state.formError ||
      Object.keys(state.fieldErrors).length
    )
      form.current
        ?.querySelectorAll<HTMLInputElement>(
          'input[name="password"], input[name="passwordConfirmation"]',
        )
        .forEach((input) => {
          input.value = "";
        });
  }, [state]);
  const invalid = state.formError === "invalid" || status === "invalid";
  return (
    <>
      <h1 ref={title} tabIndex={-1} className="text-3xl font-semibold">
        {t(
          state.completed
            ? "completedTitle"
            : invalid
              ? "invalidTitle"
              : status === "unavailable"
                ? "unavailable"
                : "resetTitle",
        )}
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        {t(
          state.completed
            ? "completedDescription"
            : invalid
              ? "invalidDescription"
              : "resetDescription",
        )}
      </p>
      {state.completed || invalid ? (
        <AccountAccessButton
          locale={locale}
          initialView={state.completed ? "login" : "recovery"}
          labels={labels}
        />
      ) : status === "valid" && token ? (
        <form
          ref={form}
          action={action}
          noValidate
          className="mt-6 space-y-5"
          aria-busy={pending}
        >
          <input type="hidden" name="token" value={token} />
          {(state.formError || Object.keys(state.fieldErrors).length > 0) && (
            <Alert
              ref={feedback}
              role="alert"
              tabIndex={-1}
              variant="destructive"
            >
              {t(state.formError === "unavailable" ? "unavailable" : "check")}
            </Alert>
          )}
          {(["password", "passwordConfirmation"] as const).map((field) => {
            const FormInput =
              field === "password" ? NewPasswordInput : PasswordInput;
            return (
              <Field key={field}>
                <FieldLabel htmlFor={`${id}-${field}`}>{t(field)}</FieldLabel>
                <FormInput
                  {...(field === "password" ? { resetSignal: state } : {})}
                  id={`${id}-${field}`}
                  name={field}
                  autoComplete="new-password"
                  required
                  disabled={pending}
                  aria-invalid={!!state.fieldErrors[field] || undefined}
                  aria-describedby={
                    state.fieldErrors[field]
                      ? `${id}-${field}-error`
                      : undefined
                  }
                />
                {state.fieldErrors[field] && (
                  <FieldError id={`${id}-${field}-error`}>
                    {t(state.fieldErrors[field])}
                  </FieldError>
                )}
              </Field>
            );
          })}
          <Button type="submit" disabled={pending} className="min-h-11 w-full">
            {t(pending ? "pending" : "savePassword")}
          </Button>
        </form>
      ) : null}
    </>
  );
}

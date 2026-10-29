"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";

import { useActionState, useEffect, useId, useRef } from "react";
import { login } from "@/app/[locale]/auth-actions";
import type { LoginActionState } from "@/auth/login-action";
import type { ValidationCode } from "@/auth/validation";
import { Link } from "@/i18n/navigation";
import { CaptchaWidget } from "./captcha-widget";
import { useTranslations } from "next-intl";
import { PasswordInput } from "./password-input";

export type LoginLabels = {
  title: string;
  description: string;
  email: string;
  password: string;
  submit: string;
  pending: string;
  signupPrompt: string;
  signup: string;
  check: string;
  captcha: string;
  invalidCredentials: string;
  unavailable: string;
  errors: Record<ValidationCode, string>;
};
const initialState: LoginActionState = {
  values: { email: "" },
  fieldErrors: {},
};

export function LoginForm({
  locale,
  labels,
  titleId,
  descriptionId,
  onPendingChange,
  onSuccess,
  onNavigate,
  onSubmit,
  onForgotPassword,
  initialEmail = "",
  uploadIntent = false,
}: {
  locale: string;
  labels: LoginLabels;
  titleId: string;
  descriptionId: string;
  onPendingChange(pending: boolean): void;
  onSuccess(): void;
  onNavigate(): void;
  onSubmit(): void;
  onForgotPassword(email: string): void;
  initialEmail?: string;
  uploadIntent?: boolean;
}) {
  const [state, action, pending] = useActionState(login.bind(null, locale), {
    ...initialState,
    values: { email: initialEmail },
  });
  const recovery = useTranslations("AccountEmails.ui");
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const hasErrors =
    !!state.formError || Object.keys(state.fieldErrors).length > 0;
  useEffect(() => {
    form.current
      ?.querySelector<HTMLInputElement>('input[name="email"]')
      ?.focus();
  }, []);
  useEffect(() => {
    onPendingChange(pending);
  }, [pending, onPendingChange]);
  useEffect(() => {
    if (!state.success && !hasErrors) return;
    const password = form.current?.elements.namedItem("password");
    if (password instanceof HTMLInputElement) password.value = "";
    if (state.success) onSuccess();
    else if (hasErrors) alert.current?.focus();
  }, [state, hasErrors, onSuccess]);

  return (
    <>
      <DialogTitle
        id={titleId}
        className="pr-10 text-2xl font-semibold tracking-tight"
      >
        {labels.title}
      </DialogTitle>
      <DialogDescription
        id={descriptionId}
        className="mt-2 text-sm text-muted-foreground"
      >
        {labels.description}
      </DialogDescription>
      <form
        ref={form}
        action={action}
        onSubmitCapture={onSubmit}
        aria-busy={pending}
        className="mt-6 space-y-5"
      >
        {uploadIntent && <input type="hidden" name="intent" value="upload" />}
        {hasErrors && (
          <Alert ref={alert} role="alert" tabIndex={-1} variant="destructive">
            {state.formError ? labels[state.formError] : labels.check}
          </Alert>
        )}
        {(["email", "password"] as const).map((field) => {
          const error = state.fieldErrors[field];
          const FormInput = field === "password" ? PasswordInput : Input;
          return (
            <Field key={field}>
              <FieldLabel htmlFor={`${id}-${field}`}>
                {labels[field]}
              </FieldLabel>
              <FormInput
                id={`${id}-${field}`}
                name={field}
                {...(field === "email" ? { type: "email" } : {})}
                autoComplete={
                  field === "email" ? "username" : "current-password"
                }
                required
                defaultValue={
                  field === "email" ? state.values.email : undefined
                }
                maxLength={field === "email" ? 254 : undefined}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-${field}-error` : undefined}
                className="min-h-11"
              />
              {error && (
                <FieldError id={`${id}-${field}-error`}>
                  {labels.errors[error]}
                </FieldError>
              )}
            </Field>
          );
        })}
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            const email = form.current?.elements.namedItem("email");
            onForgotPassword(
              email instanceof HTMLInputElement
                ? email.value.slice(0, 254)
                : "",
            );
          }}
          variant="link"
          className="min-h-11"
        >
          {recovery("forgot")}
        </Button>
        <CaptchaWidget
          locale={locale}
          resetSignal={state}
          unavailable={labels.captcha}
          challengeUrl="/api/altcha/login/challenge"
        />
        <Button
          type="submit"
          disabled={pending}
          className="min-h-11 w-full disabled:cursor-wait"
        >
          {pending ? labels.pending : labels.submit}
        </Button>
        <Alert role="status" aria-live="polite" className=" empty:hidden">
          {pending ? labels.pending : ""}
        </Alert>
      </form>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        {labels.signupPrompt}{" "}
        <Link
          href={uploadIntent ? "/signup?intent=upload" : "/signup"}
          aria-disabled={pending || undefined}
          onClick={(event) => {
            if (pending) event.preventDefault();
            else onNavigate();
          }}
          className="font-semibold text-primary underline underline-offset-4"
        >
          {labels.signup}
        </Link>
      </p>
    </>
  );
}

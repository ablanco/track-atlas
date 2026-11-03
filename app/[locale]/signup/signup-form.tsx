"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import type { LegalAcceptanceInput } from "@/legal/acceptance-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";

import { useActionState, useEffect, useRef } from "react";
import type { SignupActionState } from "@/auth/signup-action";
import type { SignupValues } from "@/auth/validation";
import { signup } from "./actions";
import { CaptchaWidget } from "@/components/captcha-widget";
import { PasswordInput } from "@/components/password-input";

export type SignupLabels = {
  fields: Record<keyof SignupValues | "password", string>;
  errors: Record<
    | "required"
    | "tooLong"
    | "invalid"
    | "future"
    | "underage"
    | "stale"
    | "emailTaken"
    | "passwordTooLong",
    string
  >;
  optional: string;
  submit: string;
  pending: string;
  check: string;
  unavailable: string;
  afterSignup: string;
  passwordHint: string;
  captcha: string;
};
const initialState: SignupActionState = {
  values: {
    firstName: "",
    lastName: "",
    displayName: "",
    email: "",
    dateOfBirth: "",
  },
  fieldErrors: {},
};

export function SignupForm({
  locale,
  labels,
  legalRevisions,
  today,
  uploadIntent = false,
}: {
  locale: string;
  labels: SignupLabels;
  legalRevisions: Pick<LegalAcceptanceInput, "termsVersion" | "privacyVersion">;
  today: string;
  uploadIntent?: boolean;
}) {
  const t = useTranslations("Signup");
  const [state, action, pending] = useActionState(
    signup.bind(null, locale),
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const hasErrors =
    !!state.formError || Object.keys(state.fieldErrors).length > 0;
  useEffect(() => {
    if (state === initialState) return;
    const password = formRef.current?.elements.namedItem("password");
    if (password instanceof HTMLInputElement) password.value = "";
    if (hasErrors) errorRef.current?.focus();
  }, [state, hasErrors]);

  function field(name: keyof SignupValues | "password") {
    const error = state.fieldErrors[name];
    const errorMessage = error
      ? labels.errors[
          name === "password" && error === "tooLong" ? "passwordTooLong" : error
        ]
      : null;
    const type =
      name === "email"
        ? "email"
        : name === "dateOfBirth"
          ? "date"
          : name === "password"
            ? "password"
            : "text";
    const FormInput = name === "password" ? PasswordInput : Input;
    const autoComplete = {
      firstName: "given-name",
      lastName: "family-name",
      displayName: "nickname",
      email: "email",
      dateOfBirth: "bday",
      password: "new-password",
    }[name];
    return (
      <Field>
        <FieldLabel htmlFor={name}>
          {labels.fields[name]}{" "}
          {name === "displayName" ? (
            <span className="font-normal text-muted-foreground">
              ({labels.optional})
            </span>
          ) : (
            <span aria-hidden="true">*</span>
          )}
        </FieldLabel>
        <FormInput
          id={name}
          name={name}
          {...(name !== "password" ? { type } : {})}
          required={name !== "displayName"}
          autoComplete={autoComplete}
          defaultValue={name === "password" ? undefined : state.values[name]}
          maxLength={name === "email" ? 254 : undefined}
          min={name === "dateOfBirth" ? "0001-01-01" : undefined}
          max={name === "dateOfBirth" ? today : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [
              error ? `${name}-error` : "",
              name === "password" ? "password-hint" : "",
              name === "dateOfBirth" ? "birthday-hint" : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          className="min-h-11"
        />
        {name === "dateOfBirth" && (
          <FieldDescription id="birthday-hint">
            {t("adultHint")}
          </FieldDescription>
        )}
        {name === "password" && (
          <FieldDescription id="password-hint">
            {labels.passwordHint}
          </FieldDescription>
        )}
        {errorMessage && (
          <FieldError id={`${name}-error`}>{errorMessage}</FieldError>
        )}
      </Field>
    );
  }

  return (
    <form
      action={action}
      ref={formRef}
      aria-busy={pending}
      className="mt-7 space-y-5"
    >
      {uploadIntent && <input type="hidden" name="intent" value="upload" />}
      {hasErrors && (
        <Alert ref={errorRef} role="alert" tabIndex={-1} variant="destructive">
          {state.formError === "captcha"
            ? labels.captcha
            : state.formError
              ? labels.unavailable
              : labels.check}
        </Alert>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        {field("firstName")}
        {field("lastName")}
      </div>
      {field("displayName")}
      {field("email")}
      {field("dateOfBirth")}
      {field("password")}
      {(
        [
          ["termsAccepted", "termsVersion", "terms", "termsAcceptance"],
          [
            "privacyAcknowledged",
            "privacyVersion",
            "privacy",
            "privacyAcknowledgment",
          ],
        ] as const
      ).map(([name, versionField, document, message]) => (
        <Field key={name}>
          <input
            type="hidden"
            name={versionField}
            value={legalRevisions[versionField]}
          />
          <div className="flex items-start gap-3">
            <input
              id={name}
              name={name}
              type="checkbox"
              value="on"
              required
              className="mt-1 size-5 shrink-0 accent-primary"
              aria-invalid={state.fieldErrors[name] ? true : undefined}
              aria-describedby={
                state.fieldErrors[name] ? `${name}-error` : undefined
              }
            />
            <label htmlFor={name} className="text-sm leading-6">
              {t.rich(message, {
                document: (chunks) => (
                  <Link
                    href={`/legal/${document}/${legalRevisions[versionField]}`}
                    target="_blank"
                    rel="noopener"
                    className="underline underline-offset-4"
                  >
                    {chunks}
                  </Link>
                ),
              })}{" "}
              <span aria-hidden="true">*</span>
            </label>
          </div>
          {state.fieldErrors[name] && (
            <FieldError id={`${name}-error`}>
              {labels.errors[state.fieldErrors[name]]}
            </FieldError>
          )}
        </Field>
      ))}
      <CaptchaWidget
        locale={locale}
        resetSignal={state}
        unavailable={labels.captcha}
      />
      <Button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full disabled:cursor-wait"
      >
        {pending ? labels.pending : labels.submit}
      </Button>
      <Alert role="status" className="text-center empty:hidden">
        {pending ? labels.pending : labels.afterSignup}
      </Alert>
    </form>
  );
}

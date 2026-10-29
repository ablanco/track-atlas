"use client";

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
import type { SignupField } from "@/auth/validation";
import { signup } from "./actions";
import { CaptchaWidget } from "@/components/captcha-widget";
import { PasswordInput } from "@/components/password-input";

export type SignupLabels = {
  fields: Record<SignupField, string>;
  errors: Record<
    | "required"
    | "tooLong"
    | "invalid"
    | "future"
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
  today,
  uploadIntent = false,
}: {
  locale: string;
  labels: SignupLabels;
  today: string;
  uploadIntent?: boolean;
}) {
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

  function field(name: SignupField) {
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
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          className="min-h-11"
        />
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

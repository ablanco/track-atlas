"use client";

import { useActionState, useEffect, useRef } from "react";
import type { SignupActionState } from "@/auth/signup-action";
import type { SignupField } from "@/auth/validation";
import { signup } from "./actions";
import { CaptchaWidget } from "@/components/captcha-widget";
import { PasswordInput } from "@/components/password-input";

export type SignupLabels = {
  fields: Record<SignupField, string>;
  errors: Record<"required" | "tooLong" | "invalid" | "future" | "emailTaken" | "passwordTooLong", string>;
  optional: string;
  submit: string;
  pending: string;
  check: string;
  unavailable: string;
  afterSignup: string;
  passwordHint: string;
  captcha: string;
};
const initialState: SignupActionState = { values: { firstName: "", lastName: "", displayName: "", email: "", dateOfBirth: "" }, fieldErrors: {} };

export function SignupForm({ locale, labels, today }: { locale: string; labels: SignupLabels; today: string }) {
  const [state, action, pending] = useActionState(signup.bind(null, locale), initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const hasErrors = !!state.formError || Object.keys(state.fieldErrors).length > 0;
  useEffect(() => {
    if (state === initialState) return;
    const password = formRef.current?.elements.namedItem("password");
    if (password instanceof HTMLInputElement) password.value = "";
    if (hasErrors) errorRef.current?.focus();
  }, [state, hasErrors]);

  function field(name: SignupField) {
    const error = state.fieldErrors[name];
    const errorMessage = error ? labels.errors[name === "password" && error === "tooLong" ? "passwordTooLong" : error] : null;
    const type = name === "email" ? "email" : name === "dateOfBirth" ? "date" : name === "password" ? "password" : "text";
    const Input = name === "password" ? PasswordInput : "input";
    const autoComplete = { firstName: "given-name", lastName: "family-name", displayName: "nickname", email: "email", dateOfBirth: "bday", password: "new-password" }[name];
    return (
      <div>
        <label htmlFor={name} className="block text-sm font-semibold">
          {labels.fields[name]} {name === "displayName" ? <span className="font-normal text-muted">({labels.optional})</span> : <span aria-hidden="true">*</span>}
        </label>
        <Input id={name} name={name} {...(name !== "password" ? { type } : {})} required={name !== "displayName"} autoComplete={autoComplete}
          defaultValue={name === "password" ? undefined : state.values[name]}
          maxLength={name === "email" ? 254 : undefined}
          min={name === "dateOfBirth" ? "0001-01-01" : undefined} max={name === "dateOfBirth" ? today : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={[error ? `${name}-error` : "", name === "password" ? "password-hint" : ""].filter(Boolean).join(" ") || undefined}
          className="mt-2 block min-h-11 w-full min-w-0 rounded-md border border-default bg-surface px-3 py-2 text-primary" />
        {name === "password" && <p id="password-hint" className="mt-2 text-xs text-muted">{labels.passwordHint}</p>}
        {errorMessage && <p id={`${name}-error`} className="mt-2 text-sm font-medium">{errorMessage}</p>}
      </div>
    );
  }

  return (
    <form action={action} ref={formRef} aria-busy={pending} className="mt-7 space-y-5">
      {hasErrors && <p ref={errorRef} role="alert" tabIndex={-1} className="rounded-md border border-default bg-surface-muted p-3 text-sm font-medium">{state.formError === "captcha" ? labels.captcha : state.formError ? labels.unavailable : labels.check}</p>}
      <div className="grid gap-5 sm:grid-cols-2">{field("firstName")}{field("lastName")}</div>
      {field("displayName")}{field("email")}{field("dateOfBirth")}{field("password")}
      <CaptchaWidget locale={locale} resetSignal={state} unavailable={labels.captcha} />
      <button type="submit" disabled={pending} className="min-h-11 w-full rounded-md bg-accent px-4 py-3 text-sm font-semibold text-on-accent disabled:cursor-wait disabled:opacity-70">{pending ? labels.pending : labels.submit}</button>
      <p role="status" aria-live="polite" className="text-center text-xs text-muted">{pending ? labels.pending : labels.afterSignup}</p>
    </form>
  );
}

"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { login } from "@/app/[locale]/auth-actions";
import type { LoginActionState } from "@/auth/login-action";
import type { ValidationCode } from "@/auth/validation";
import { Link } from "@/i18n/navigation";
import { CaptchaWidget } from "./captcha-widget";
import { useTranslations } from "next-intl";

export type LoginLabels = {
  title: string; description: string; email: string; password: string; submit: string; pending: string;
  signupPrompt: string; signup: string; check: string; captcha: string; invalidCredentials: string; unavailable: string;
  errors: Record<ValidationCode, string>;
};
const initialState: LoginActionState = { values: { email: "" }, fieldErrors: {} };

export function LoginForm({ locale, labels, titleId, descriptionId, onPendingChange, onSuccess, onNavigate, onSubmit, onForgotPassword, initialEmail = "" }: {
  locale: string; labels: LoginLabels; titleId: string; descriptionId: string;
  onPendingChange(pending: boolean): void; onSuccess(): void; onNavigate(): void; onSubmit(): void;
  onForgotPassword(email: string): void; initialEmail?: string;
}) {
  const [state, action, pending] = useActionState(login.bind(null, locale), { ...initialState, values: { email: initialEmail } });
  const recovery = useTranslations("AccountEmails.ui");
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const hasErrors = !!state.formError || Object.keys(state.fieldErrors).length > 0;
  useEffect(() => { form.current?.querySelector<HTMLInputElement>('input[name="email"]')?.focus(); }, []);
  useEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);
  useEffect(() => {
    if (!state.success && !hasErrors) return;
    const password = form.current?.elements.namedItem("password");
    if (password instanceof HTMLInputElement) password.value = "";
    if (state.success) onSuccess();
    else if (hasErrors) alert.current?.focus();
  }, [state, hasErrors, onSuccess]);

  return (
    <>
      <h2 id={titleId} className="pr-10 text-2xl font-semibold tracking-tight">{labels.title}</h2>
      <p id={descriptionId} className="mt-2 text-sm text-muted">{labels.description}</p>
      <form ref={form} action={action} onSubmitCapture={onSubmit} aria-busy={pending} className="mt-6 space-y-5">
        {hasErrors && <p ref={alert} role="alert" tabIndex={-1} className="rounded-md border border-default bg-surface-muted p-3 text-sm">{state.formError ? labels[state.formError] : labels.check}</p>}
        {(["email", "password"] as const).map((field) => {
          const error = state.fieldErrors[field];
          return <div key={field}>
            <label htmlFor={`${id}-${field}`} className="block text-sm font-semibold">{labels[field]}</label>
            <input id={`${id}-${field}`} name={field} type={field === "email" ? "email" : "password"}
              autoComplete={field === "email" ? "username" : "current-password"} required
              defaultValue={field === "email" ? state.values.email : undefined} maxLength={field === "email" ? 254 : undefined}
              aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-${field}-error` : undefined}
              className="mt-2 block min-h-11 w-full min-w-0 rounded-md border border-default bg-surface px-3 py-2 text-primary" />
            {error && <p id={`${id}-${field}-error`} className="mt-2 text-sm">{labels.errors[error]}</p>}
          </div>;
        })}
        <button type="button" disabled={pending} onClick={() => { const email = form.current?.elements.namedItem("email"); onForgotPassword(email instanceof HTMLInputElement ? email.value.slice(0,254) : ""); }} className="min-h-11 text-sm font-semibold text-accent underline underline-offset-4">{recovery("forgot")}</button>
        <CaptchaWidget locale={locale} resetSignal={state} unavailable={labels.captcha} challengeUrl="/api/altcha/login/challenge" />
        <button type="submit" disabled={pending} className="min-h-11 w-full rounded-md bg-accent px-4 py-3 text-sm font-semibold text-on-accent disabled:cursor-wait disabled:opacity-70">{pending ? labels.pending : labels.submit}</button>
        <p role="status" aria-live="polite" className="text-sm text-muted">{pending ? labels.pending : ""}</p>
      </form>
      <p className="mt-5 text-center text-sm text-muted">{labels.signupPrompt} <Link href="/signup" aria-disabled={pending || undefined} onClick={(event) => { if (pending) event.preventDefault(); else onNavigate(); }} className="font-semibold text-accent underline underline-offset-4">{labels.signup}</Link></p>
    </>
  );
}

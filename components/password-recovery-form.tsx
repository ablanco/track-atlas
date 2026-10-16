"use client";
import { useActionState, useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { requestPasswordResetEmail } from "@/app/[locale]/email-actions";
import type { RecoveryActionState } from "@/auth/account-email-action";
export function PasswordRecoveryForm({ locale, email, titleId, descriptionId, onPendingChange, onBack }: { locale: string; email: string; titleId: string; descriptionId: string; onPendingChange(pending: boolean): void; onBack(email: string): void }) {
  const t = useTranslations("AccountEmails.ui"), id = useId(), form = useRef<HTMLFormElement>(null), feedback = useRef<HTMLParagraphElement>(null);
  const [state, action, pending] = useActionState(requestPasswordResetEmail.bind(null,locale), { values: { email }, fieldErrors: {} } as RecoveryActionState);
  useEffect(() => { onPendingChange(pending); },[pending,onPendingChange]);
  useEffect(() => { if (state.requested || state.formError || state.fieldErrors.email) feedback.current?.focus(); },[state]);
  useEffect(() => { form.current?.querySelector("input")?.focus(); },[]);
  return <><h2 id={titleId} className="pr-10 text-2xl font-semibold">{t(state.requested ? "checkEmail" : "recoveryTitle")}</h2>
    <p id={descriptionId} className="mt-2 text-sm text-muted">{t(state.requested ? "checkSpam" : "recoveryDescription")}</p>
    {state.requested ? <p ref={feedback} role="status" tabIndex={-1} className="mt-6 rounded-md bg-surface-muted p-4 text-sm">{t("genericResponse")}</p> :
      <form ref={form} action={action} noValidate className="mt-6 space-y-5" aria-busy={pending}>
        {(state.formError || state.fieldErrors.email) && <p ref={feedback} role="alert" tabIndex={-1} className="text-sm">{t(state.formError ?? "check")}</p>}
        <div><label htmlFor={`${id}-email`} className="block text-sm font-semibold">{t("email")}</label><input id={`${id}-email`} name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={state.values.email} disabled={pending} aria-invalid={!!state.fieldErrors.email || undefined} aria-describedby={state.fieldErrors.email ? `${id}-error` : undefined} className="mt-2 min-h-11 w-full rounded-md border border-default bg-surface px-3 py-2 aria-invalid:border-danger" />
          {state.fieldErrors.email && <p id={`${id}-error`} className="mt-2 text-sm text-danger">{t(state.fieldErrors.email)}</p>}</div>
        <button disabled={pending} className="min-h-11 w-full rounded-md bg-accent px-4 py-3 text-sm font-semibold text-on-accent disabled:opacity-60">{t(pending ? "pending" : "sendReset")}</button>
      </form>}
    <button type="button" disabled={pending} onClick={() => { const input = form.current?.elements.namedItem("email"); onBack(input instanceof HTMLInputElement ? input.value.slice(0,254) : state.values.email); }} className="mt-5 min-h-11 w-full text-sm font-semibold text-accent underline underline-offset-4">{t("backLogin")}</button>
  </>;
}

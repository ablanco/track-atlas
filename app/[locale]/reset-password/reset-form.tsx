"use client";
import { useActionState, useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { resetPasswordFromLink } from "../email-actions";
import type { ResetLinkActionState } from "@/auth/account-email-action";
import { AccountAccessButton } from "@/components/account-access-button";
import type { AuthLabels } from "@/components/auth-control";
import type { LinkStatus } from "../confirm-email/confirmation-form";
export function ResetForm({ locale, token, status, labels }: { locale: string; token: string | null; status: LinkStatus; labels: AuthLabels }) {
  const t = useTranslations("AccountEmails.ui"), id = useId(), form = useRef<HTMLFormElement>(null), feedback = useRef<HTMLParagraphElement>(null), title = useRef<HTMLHeadingElement>(null);
  const [state, action, pending] = useActionState(resetPasswordFromLink.bind(null,locale), { fieldErrors: {} } as ResetLinkActionState);
  useEffect(() => {
    if (state.completed) { window.history.replaceState(null,"",window.location.pathname); title.current?.focus(); }
    if (state.formError || Object.keys(state.fieldErrors).length) feedback.current?.focus();
    if (state.completed || state.formError || Object.keys(state.fieldErrors).length) form.current?.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input => {input.value="";});
  },[state]);
  const invalid = state.formError === "invalid" || status === "invalid";
  return <><h1 ref={title} tabIndex={-1} className="text-3xl font-semibold">{t(state.completed ? "completedTitle" : invalid ? "invalidTitle" : status === "unavailable" ? "unavailable" : "resetTitle")}</h1>
    <p className="mt-4 text-sm text-muted">{t(state.completed ? "completedDescription" : invalid ? "invalidDescription" : "resetDescription")}</p>
    {state.completed || invalid ? <AccountAccessButton locale={locale} initialView={state.completed ? "login" : "recovery"} labels={labels} /> : status === "valid" && token ?
      <form ref={form} action={action} noValidate className="mt-6 space-y-5" aria-busy={pending}>
        <input type="hidden" name="token" value={token} />
        {(state.formError || Object.keys(state.fieldErrors).length > 0) && <p ref={feedback} role="alert" tabIndex={-1} className="rounded-md bg-surface-muted p-3 text-sm">{t(state.formError === "unavailable" ? "unavailable" : "check")}</p>}
        {(["password","passwordConfirmation"] as const).map(field => <div key={field}><label htmlFor={`${id}-${field}`} className="block text-sm font-semibold">{t(field)}</label>
          <input id={`${id}-${field}`} type="password" name={field} autoComplete="new-password" required disabled={pending} aria-invalid={!!state.fieldErrors[field] || undefined} aria-describedby={state.fieldErrors[field] ? `${id}-${field}-error` : undefined} className="mt-2 block min-h-11 w-full rounded-md border border-default bg-surface px-3 py-2 aria-invalid:border-danger" />
          {state.fieldErrors[field] && <p id={`${id}-${field}-error`} className="mt-2 text-sm text-danger">{t(state.fieldErrors[field])}</p>}</div>)}
        <button disabled={pending} className="min-h-11 w-full rounded-md bg-accent px-4 py-3 text-sm font-semibold text-on-accent disabled:opacity-60">{t(pending ? "pending" : "savePassword")}</button>
      </form> : null}
  </>;
}

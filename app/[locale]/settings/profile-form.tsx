"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { Link } from "@/i18n/navigation";
import type { SettingsProfile } from "@/auth/settings";
import type { ProfileActionState } from "@/auth/settings-action";
import type { SettingsLabels } from "./settings-labels";
import { saveProfile } from "./actions";
import { EmailConfirmation } from "./email-confirmation";

export function ProfileForm({ locale, profile, labels, common, emailCooldown }: { locale: string; profile: SettingsProfile; labels: SettingsLabels["profile"]; common: SettingsLabels["common"]; emailCooldown: number }) {
  const [state, action, pending] = useActionState(saveProfile.bind(null, locale), { values: { firstName: profile.firstName, lastName: profile.lastName, displayName: profile.displayName }, fieldErrors: {} } as ProfileActionState);
  const id = useId();
  const alert = useRef<HTMLParagraphElement>(null);
  const hasErrors = !!state.formError || Object.keys(state.fieldErrors).length > 0;
  useEffect(() => { if (hasErrors) alert.current?.focus(); }, [state, hasErrors]);
  return <section className="border-b border-default py-7">
    <h2 id={`${id}-title`} className="text-xl font-semibold">{labels.title}</h2>
    <p className="mt-2 text-sm text-muted">{labels.description}</p>
    <form action={action} aria-labelledby={`${id}-title`} aria-busy={pending} className="mt-5 space-y-5">
      {hasErrors && <p ref={alert} role="alert" tabIndex={-1} className="rounded-md border border-default bg-surface-muted p-3 text-sm">{state.formError ? common[state.formError] : common.check}{state.formError === "unauthorized" && <> <Link href="/" className="underline underline-offset-4">{common.goHome}</Link></>}</p>}
      <fieldset disabled={pending} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          {(["firstName", "lastName"] as const).map(field => <div key={field}>
            <label htmlFor={`${id}-${field}`} className="block text-sm font-semibold">{labels[field]}</label>
            <input id={`${id}-${field}`} name={field} autoComplete={field === "firstName" ? "given-name" : "family-name"} required defaultValue={state.values[field]}
              aria-invalid={!!state.fieldErrors[field] || undefined} aria-describedby={state.fieldErrors[field] ? `${id}-${field}-error` : undefined}
              className="mt-2 block min-h-11 w-full min-w-0 rounded-md border border-default bg-surface px-3 py-2 text-primary" />
            {state.fieldErrors[field] && <p id={`${id}-${field}-error`} className="mt-2 text-sm">{common.errors[state.fieldErrors[field]]}</p>}
          </div>)}
        </div>
        <div><label htmlFor={`${id}-displayName`} className="block text-sm font-semibold">{labels.displayName} <span className="font-normal text-muted">({common.optional})</span></label>
          <input id={`${id}-displayName`} name="displayName" autoComplete="nickname" defaultValue={state.values.displayName}
            aria-invalid={!!state.fieldErrors.displayName || undefined} aria-describedby={state.fieldErrors.displayName ? `${id}-displayName-error` : undefined}
            className="mt-2 block min-h-11 w-full min-w-0 rounded-md border border-default bg-surface px-3 py-2 text-primary" />
          {state.fieldErrors.displayName && <p id={`${id}-displayName-error`} className="mt-2 text-sm">{common.errors[state.fieldErrors.displayName]}</p>}
        </div>
        <div><label htmlFor={`${id}-email`} className="block text-sm font-semibold">{labels.email}</label>
          <input id={`${id}-email`} type="email" autoComplete="email" readOnly value={profile.email} aria-describedby={`${id}-email-hint`} className="mt-2 block min-h-11 w-full min-w-0 rounded-md border border-default bg-surface-muted px-3 py-2 text-muted" />
          <p id={`${id}-email-hint`} className="mt-2 text-sm text-muted">{labels.emailHint}</p>
          <EmailConfirmation locale={locale} confirmed={profile.emailConfirmed} initialCooldownSeconds={emailCooldown} />
        </div>
        <div><label htmlFor={`${id}-dateOfBirth`} className="block text-sm font-semibold">{labels.dateOfBirth}</label>
          <input id={`${id}-dateOfBirth`} type="date" autoComplete="bday" readOnly value={profile.dateOfBirth} aria-describedby={`${id}-dateOfBirth-hint`} className="mt-2 block min-h-11 w-full min-w-0 rounded-md border border-default bg-surface-muted px-3 py-2 text-muted" />
          <p id={`${id}-dateOfBirth-hint`} className="mt-2 text-sm text-muted">{labels.dateOfBirthHint}</p>
        </div>
        <button type="submit" className="min-h-11 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:cursor-wait disabled:opacity-70">{pending ? labels.pending : labels.submit}</button>
      </fieldset>
      <p role="status" className="text-sm text-muted">{pending ? labels.pending : state.success ? labels.success : ""}</p>
    </form>
  </section>;
}

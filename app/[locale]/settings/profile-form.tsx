"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useTranslations } from "next-intl";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";

import { useActionState, useEffect, useId, useRef } from "react";
import { Link } from "@/i18n/navigation";
import type { SettingsProfile } from "@/auth/settings";
import type { ProfileActionState } from "@/auth/settings-action";
import type { SettingsLabels } from "./settings-labels";
import { saveProfile } from "./actions";
import { EmailConfirmation } from "./email-confirmation";

export function ProfileForm({
  locale,
  profile,
  labels,
  common,
  emailCooldown,
}: {
  locale: string;
  profile: SettingsProfile;
  labels: SettingsLabels["profile"];
  common: SettingsLabels["common"];
  emailCooldown: number;
}) {
  const [state, action, pending] = useActionState(
    saveProfile.bind(null, locale),
    {
      values: {
        firstName: profile.firstName,
        lastName: profile.lastName,
        displayName: profile.displayName,
      },
      fieldErrors: {},
    } as ProfileActionState,
  );
  const id = useId();
  const emailLabels = useTranslations("AccountEmails.ui");
  const alert = useRef<HTMLDivElement>(null);
  const hasErrors =
    !!state.formError || Object.keys(state.fieldErrors).length > 0;
  useEffect(() => {
    if (hasErrors) alert.current?.focus();
  }, [state, hasErrors]);
  return (
    <section className="border-b border-border py-7">
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        {labels.title}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{labels.description}</p>
      <form
        action={action}
        aria-labelledby={`${id}-title`}
        aria-busy={pending}
        className="mt-5 space-y-5"
      >
        {hasErrors && (
          <Alert ref={alert} role="alert" tabIndex={-1} variant="destructive">
            {state.formError ? common[state.formError] : common.check}
            {state.formError === "unauthorized" && (
              <>
                {" "}
                <Link href="/" className="underline underline-offset-4">
                  {common.goHome}
                </Link>
              </>
            )}
          </Alert>
        )}
        <fieldset disabled={pending} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            {(["firstName", "lastName"] as const).map((field) => (
              <Field key={field}>
                <FieldLabel htmlFor={`${id}-${field}`}>
                  {labels[field]}
                </FieldLabel>
                <Input
                  id={`${id}-${field}`}
                  name={field}
                  autoComplete={
                    field === "firstName" ? "given-name" : "family-name"
                  }
                  required
                  defaultValue={state.values[field]}
                  aria-invalid={!!state.fieldErrors[field] || undefined}
                  aria-describedby={
                    state.fieldErrors[field]
                      ? `${id}-${field}-error`
                      : undefined
                  }
                  className="min-h-11"
                />
                {state.fieldErrors[field] && (
                  <FieldError id={`${id}-${field}-error`}>
                    {common.errors[state.fieldErrors[field]]}
                  </FieldError>
                )}
              </Field>
            ))}
          </div>
          <Field>
            <FieldLabel htmlFor={`${id}-displayName`}>
              {labels.displayName}{" "}
              <span className="font-normal text-muted-foreground">
                ({common.optional})
              </span>
            </FieldLabel>
            <Input
              id={`${id}-displayName`}
              name="displayName"
              autoComplete="nickname"
              defaultValue={state.values.displayName}
              aria-invalid={!!state.fieldErrors.displayName || undefined}
              aria-describedby={
                state.fieldErrors.displayName
                  ? `${id}-displayName-error`
                  : undefined
              }
              className="min-h-11"
            />
            {state.fieldErrors.displayName && (
              <FieldError id={`${id}-displayName-error`}>
                {common.errors[state.fieldErrors.displayName]}
              </FieldError>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-email`}>{labels.email}</FieldLabel>
            <InputGroup className="min-h-11">
              <InputGroupInput
                id={`${id}-email`}
                type="email"
                autoComplete="email"
                disabled
                value={profile.email}
                aria-describedby={
                  profile.emailConfirmed
                    ? `${id}-email-hint ${id}-email-confirmed`
                    : `${id}-email-hint`
                }
                className="min-h-11"
              />
              {profile.emailConfirmed && (
                <InputGroupAddon
                  align="inline-end"
                  className="shrink-0 cursor-default"
                >
                  <span
                    id={`${id}-email-confirmed`}
                    className="whitespace-nowrap rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success"
                  >
                    {emailLabels("confirmed")}
                  </span>
                </InputGroupAddon>
              )}
            </InputGroup>
            <FieldDescription id={`${id}-email-hint`}>
              {labels.emailHint}
            </FieldDescription>
            {!profile.emailConfirmed && (
              <EmailConfirmation
                locale={locale}
                initialCooldownSeconds={emailCooldown}
              />
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-dateOfBirth`}>
              {labels.dateOfBirth}
            </FieldLabel>
            <Input
              id={`${id}-dateOfBirth`}
              type="date"
              autoComplete="bday"
              disabled
              value={profile.dateOfBirth}
              aria-describedby={`${id}-dateOfBirth-hint`}
              className="min-h-11"
            />
            <FieldDescription id={`${id}-dateOfBirth-hint`}>
              {labels.dateOfBirthHint}
            </FieldDescription>
          </Field>
          <Button type="submit" className="min-h-11 disabled:cursor-wait">
            {pending ? labels.pending : labels.submit}
          </Button>
        </fieldset>
        <Alert role="status" className=" empty:hidden">
          {pending ? labels.pending : state.success ? labels.success : ""}
        </Alert>
      </form>
    </section>
  );
}

"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link } from "@/i18n/navigation";
import { Modal } from "@/components/modal";
import {
  validatePassword,
  type PasswordErrors,
} from "@/auth/settings-validation";
import type { PasswordActionState } from "@/auth/settings-action";
import { changePassword } from "./actions";
import type { SettingsLabels } from "./settings-labels";
import { PasswordInput } from "@/components/password-input";

const initial: PasswordActionState = { fieldErrors: {} };
export function PasswordForm({
  locale,
  labels,
  common,
}: {
  locale: string;
  labels: SettingsLabels["password"];
  common: SettingsLabels["common"];
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const snapshot = useRef<FormData | null>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [localErrors, setLocalErrors] = useState<PasswordErrors | null>(null);
  const [state, action, pending] = useActionState(
    async (previous: PasswordActionState, submitted: FormData) => {
      let result: PasswordActionState;
      try {
        result = await changePassword(locale, previous, submitted);
      } catch {
        result = { fieldErrors: {}, formError: "unavailable" };
      }
      for (const field of ["password", "passwordConfirmation"]) {
        const input = form.current?.elements.namedItem(field);
        if (input instanceof HTMLInputElement) input.value = "";
        submitted.delete(field);
      }
      setOpen(false);
      setLocalErrors(null);
      return result;
    },
    initial,
  );
  const errors = localErrors ?? state.fieldErrors;
  const formError = localErrors === null ? state.formError : undefined;
  const hasErrors = !!formError || Object.keys(errors).length > 0;
  useEffect(() => {
    if (hasErrors && !open) alert.current?.focus();
  }, [state, localErrors, hasErrors, open]);
  const dismiss = () => {
    if (!pending) {
      snapshot.current = null;
      setOpen(false);
    }
  };
  return (
    <section className="border-b border-default py-7">
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        {labels.title}
      </h2>
      <p className="mt-2 text-sm text-muted">{labels.description}</p>
      <form
        ref={form}
        aria-labelledby={`${id}-title`}
        aria-busy={pending}
        noValidate
        className="mt-5 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || open) return;
          const submitted = new FormData(event.currentTarget);
          const parsed = validatePassword(submitted);
          setLocalErrors(parsed.ok ? {} : parsed.errors);
          if (parsed.ok) {
            snapshot.current = submitted;
            setOpen(true);
          }
        }}
      >
        {hasErrors && (
          <p
            ref={alert}
            role="alert"
            tabIndex={-1}
            className="rounded-md border border-default bg-surface-muted p-3 text-sm"
          >
            {formError ? common[formError] : common.check}
            {formError === "unauthorized" && (
              <>
                {" "}
                <Link href="/" className="underline underline-offset-4">
                  {common.goHome}
                </Link>
              </>
            )}
          </p>
        )}
        <fieldset disabled={pending || open} className="space-y-5">
          {(["password", "passwordConfirmation"] as const).map((field) => (
            <div key={field}>
              <label
                htmlFor={`${id}-${field}`}
                className="block text-sm font-semibold"
              >
                {labels[field]}
              </label>
              <PasswordInput
                id={`${id}-${field}`}
                name={field}
                autoComplete="new-password"
                required
                aria-invalid={!!errors[field] || undefined}
                aria-describedby={`${id}-hint${errors[field] ? ` ${id}-${field}-error` : ""}`}
              />
              {errors[field] && (
                <p
                  id={`${id}-${field}-error`}
                  className="mt-2 text-sm text-danger"
                >
                  {errors[field] === "tooLong"
                    ? common.passwordTooLong
                    : common.errors[errors[field]]}
                </p>
              )}
            </div>
          ))}
          <p id={`${id}-hint`} className="text-sm text-muted">
            {labels.hint}
          </p>
          <button
            ref={trigger}
            type="submit"
            className="min-h-11 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:cursor-wait disabled:opacity-70"
          >
            {labels.submit}
          </button>
        </fieldset>
        <p role="status" className="text-sm text-muted">
          {pending
            ? labels.pending
            : state.success && localErrors === null && !open
              ? labels.success
              : ""}
        </p>
      </form>
      {open && (
        <Modal
          titleId={`${id}-confirm-title`}
          descriptionId={`${id}-confirm-description`}
          closeLabel={common.close}
          busy={pending}
          onClose={dismiss}
          initialFocus="[data-cancel]"
          returnFocus={trigger}
        >
          <h2
            id={`${id}-confirm-title`}
            className="pr-10 text-2xl font-semibold tracking-tight"
          >
            {labels.confirmTitle}
          </h2>
          <p
            id={`${id}-confirm-description`}
            className="mt-3 text-sm text-muted"
          >
            {labels.confirmDescription}
          </p>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              data-cancel
              disabled={pending}
              onClick={dismiss}
              className="min-h-11 rounded-md border border-default px-4 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-70"
            >
              {common.cancel}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const submitted = snapshot.current;
                if (pending || !submitted) return;
                snapshot.current = null;
                startTransition(() => action(submitted));
              }}
              className="min-h-11 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:cursor-wait disabled:opacity-70"
            >
              {pending ? labels.pending : labels.submit}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

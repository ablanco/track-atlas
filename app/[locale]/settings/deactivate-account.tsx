"use client";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link } from "@/i18n/navigation";
import type { DeactivateActionState } from "@/auth/settings-action";
import { disableAccount } from "./actions";
import type { SettingsLabels } from "./settings-labels";

const initial: DeactivateActionState = {};
export function DeactivateAccount({
  locale,
  labels,
  common,
}: {
  locale: string;
  labels: SettingsLabels["deactivate"];
  common: SettingsLabels["common"];
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const submitted = useRef(false);
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: DeactivateActionState) => {
      let result: DeactivateActionState;
      try {
        result = await disableAccount(locale, previous);
      } catch {
        result = { formError: "unavailable" };
      }
      submitted.current = false;
      setOpen(false);
      return result;
    },
    initial,
  );
  useEffect(() => {
    if (state.formError || state.deactivated) alert.current?.focus();
  }, [state]);
  const dismiss = () => {
    if (!pending) setOpen(false);
  };
  return (
    <section className="py-7">
      <h2 className="text-xl font-semibold">{labels.title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{labels.description}</p>
      {state.deactivated ? (
        <Alert ref={alert} tabIndex={-1} role="status" className="mt-5">
          {labels.completed}{" "}
          <Link href="/" className="font-semibold underline underline-offset-4">
            {common.goHome}
          </Link>
        </Alert>
      ) : (
        <>
          {state.formError && (
            <Alert
              ref={alert}
              role="alert"
              tabIndex={-1}
              className="mt-5"
              variant="destructive"
            >
              {common[state.formError]}
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
          <Button
            ref={trigger}
            type="button"
            disabled={pending}
            onClick={() => setOpen(true)}
            variant="destructive"
            className="mt-5 min-h-11 disabled:cursor-wait"
          >
            {labels.submit}
          </Button>
        </>
      )}
      <Alert role="status" className="mt-3 empty:hidden">
        {pending ? labels.pending : ""}
      </Alert>
      <Dialog
        open={open}
        disablePointerDismissal={pending}
        onOpenChange={(open, details) => {
          if (open) return;
          if (pending) details.cancel();
          else dismiss();
        }}
      >
        <DialogContent
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-description`}
          aria-busy={pending}
          closeButtonProps={{ disabled: pending }}
          initialFocus={cancel}
          finalFocus={trigger}
          className="block"
        >
          <DialogTitle
            id={`${id}-title`}
            className="pr-10 text-2xl font-semibold tracking-tight"
          >
            {labels.confirmTitle}
          </DialogTitle>
          <DialogDescription
            id={`${id}-description`}
            className="mt-3 text-sm text-muted-foreground"
          >
            {labels.confirmDescription}
          </DialogDescription>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              ref={cancel}
              disabled={pending}
              onClick={dismiss}
              variant="outline"
              className="min-h-11 disabled:cursor-wait"
            >
              {common.cancel}
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                if (pending || submitted.current) return;
                submitted.current = true;
                startTransition(action);
              }}
              variant="destructive"
              className="min-h-11 disabled:cursor-wait"
            >
              {pending ? labels.pending : labels.submit}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

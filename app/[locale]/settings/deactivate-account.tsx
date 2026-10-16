"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { Modal } from "@/components/modal";
import type { DeactivateActionState } from "@/auth/settings-action";
import { disableAccount } from "./actions";
import type { SettingsLabels } from "./settings-labels";

const initial: DeactivateActionState = {};
export function DeactivateAccount({ locale, labels, common }: { locale: string; labels: SettingsLabels["deactivate"]; common: SettingsLabels["common"] }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const submitted = useRef(false);
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (previous: DeactivateActionState) => {
    let result: DeactivateActionState;
    try { result = await disableAccount(locale, previous); }
    catch { result = { formError: "unavailable" }; }
    submitted.current = false; setOpen(false);
    return result;
  }, initial);
  useEffect(() => { if (state.formError || state.deactivated) alert.current?.focus(); }, [state]);
  const dismiss = () => { if (!pending) setOpen(false); };
  return <section className="py-7">
    <h2 className="text-xl font-semibold">{labels.title}</h2>
    <p className="mt-2 text-sm text-muted">{labels.description}</p>
    {state.deactivated ? <p ref={alert} tabIndex={-1} role="status" className="mt-5 text-sm">{labels.completed} <Link href="/" className="font-semibold underline underline-offset-4">{common.goHome}</Link></p> : <>
      {state.formError && <p ref={alert} role="alert" tabIndex={-1} className="mt-5 rounded-md border border-default bg-surface-muted p-3 text-sm">{common[state.formError]}{state.formError === "unauthorized" && <> <Link href="/" className="underline underline-offset-4">{common.goHome}</Link></>}</p>}
      <button ref={trigger} type="button" disabled={pending} onClick={() => setOpen(true)} className="mt-5 min-h-11 rounded-md border border-danger px-4 py-2 text-sm font-semibold text-danger disabled:cursor-wait disabled:opacity-70">{labels.submit}</button>
    </>}
    <p role="status" className="mt-3 text-sm text-muted">{pending ? labels.pending : ""}</p>
    {open && <Modal titleId={`${id}-title`} descriptionId={`${id}-description`} closeLabel={common.close} busy={pending} onClose={dismiss} initialFocus="[data-cancel]" returnFocus={trigger}>
      <h2 id={`${id}-title`} className="pr-10 text-2xl font-semibold tracking-tight">{labels.confirmTitle}</h2>
      <p id={`${id}-description`} className="mt-3 text-sm text-muted">{labels.confirmDescription}</p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" data-cancel disabled={pending} onClick={dismiss} className="min-h-11 rounded-md border border-default px-4 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-70">{common.cancel}</button>
        <button type="button" disabled={pending} onClick={() => {
          if (pending || submitted.current) return;
          submitted.current = true; startTransition(action);
        }} className="min-h-11 rounded-md bg-danger px-4 py-2 text-sm font-semibold text-on-danger disabled:cursor-wait disabled:opacity-70">{pending ? labels.pending : labels.submit}</button>
      </div>
    </Modal>}
  </section>;
}

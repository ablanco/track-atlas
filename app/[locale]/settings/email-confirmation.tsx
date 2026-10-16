"use client";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { resendEmailConfirmation } from "../email-actions";
import type { ConfirmationActionState } from "@/auth/account-email-action";
export function EmailConfirmation({ locale, confirmed, initialCooldownSeconds }: { locale: string; confirmed: boolean; initialCooldownSeconds: number }) {
  const t = useTranslations("AccountEmails.ui");
  const [state, action, pending] = useActionState(resendEmailConfirmation.bind(null, locale), {} as ConfirmationActionState);
  const [remaining, setRemaining] = useState(initialCooldownSeconds);
  const message = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (state.retryAfterSeconds !== undefined) { const end = Date.now() + state.retryAfterSeconds * 1000; const update = () => setRemaining(Math.max(0, Math.ceil((end-Date.now())/1000))); update(); const timer = setInterval(update,1000); return () => clearInterval(timer); } }, [state]);
  useEffect(() => { if (state.success || state.formError) message.current?.focus(); }, [state]);
  useEffect(() => { if (state.retryAfterSeconds !== undefined || initialCooldownSeconds <= 0) return; const end = Date.now()+initialCooldownSeconds*1000; const timer = setInterval(() => setRemaining(Math.max(0,Math.ceil((end-Date.now())/1000))),1000); return () => clearInterval(timer); }, [initialCooldownSeconds,state]);
  return <div className="mt-4 rounded-md bg-surface-muted p-4">
    <span className="inline-block rounded-full border border-default px-3 py-1 text-xs font-semibold">{t(confirmed ? "confirmed" : "notConfirmed")}</span>
    {!confirmed && <><p className="mt-3 text-sm text-muted">{t("statusDescription")}</p>
      <button type="button" disabled={pending || remaining > 0} onClick={() => startTransition(() => action(new FormData()))} className="mt-4 min-h-11 rounded-md border border-default bg-surface px-4 py-2 text-sm font-semibold disabled:opacity-60">{t(pending ? "pending" : "resend")}</button>
      {(state.success || state.formError) && <p ref={message} tabIndex={-1} role={state.formError ? "alert" : "status"} className="mt-3 text-sm">{t(state.formError ?? "requested")}</p>}
      {remaining > 0 && <p className="mt-2 text-sm text-muted">{t("cooldown", { seconds: remaining })}</p>}
    </>}
  </div>;
}

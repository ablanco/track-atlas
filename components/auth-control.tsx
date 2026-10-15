"use client";

import { useActionState, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { usePathname } from "@/i18n/navigation";
import { logout, retryAuth } from "@/app/[locale]/auth-actions";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { LoginForm, type LoginLabels } from "./login-form";
import type { LogoutActionState } from "@/auth/logout-action";

export type AuthLabels = { login: string; logout: string; loggingOut: string; unavailable: string; retry: string; close: string; form: LoginLabels };
const initialLogout: LogoutActionState = {};
const buttonClass = "min-h-11 rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-70";
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

function LoginModal({ locale, labels, onClose, onSubmit }: { locale: string; labels: AuthLabels; onClose(): void; onSubmit(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const dismiss = useCallback(() => { dialog.current?.close(); onClose(); }, [onClose]);
  const onPendingChange = useCallback((value: boolean) => { pending.current = value; setBusy(value); }, []);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLInputElement>('input[name="email"]')?.focus();
    return () => { element?.close(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, a[href], select, textarea, [tabindex]'))
        .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
      const target = event.shiftKey ? controls.at(-1) : controls[0];
      const boundary = event.shiftKey ? controls[0] : controls.at(-1);
      if (event.target === boundary) { event.preventDefault(); target?.focus({ preventScroll: true }); }
    }}
    onCancel={(event) => { event.preventDefault(); if (!pending.current) dismiss(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget || pending.current) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
    }}
    className="fixed m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-default bg-surface p-6 text-primary shadow-md backdrop:bg-modal-backdrop sm:p-8">
    <button type="button" onClick={dismiss} disabled={busy} aria-label={labels.close} className="absolute top-3 right-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted disabled:cursor-wait disabled:opacity-70"><XIcon size={22} weight="regular" aria-hidden="true" /></button>
    <LoginForm locale={locale} labels={labels.form} titleId={`${id}-title`} descriptionId={`${id}-description`}
      onPendingChange={onPendingChange} onSuccess={dismiss} onNavigate={dismiss} onSubmit={onSubmit} />
  </dialog>;
}

type AuthControlProps = { status: "guest" | "authenticated" | "unavailable"; locale: string; labels: AuthLabels };

export function AuthControl(props: AuthControlProps) {
  const pathname = usePathname();
  return <AuthControlState key={pathname} {...props} />;
}

function AuthControlState({ status, locale, labels }: AuthControlProps) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [open, setOpen] = useState(false);
  const [previousStatus, setPreviousStatus] = useState(status);
  const [logoutState, logoutAction, loggingOut] = useActionState(logout, initialLogout);
  const [retrying, startRetry] = useTransition();
  const trigger = useRef<HTMLButtonElement>(null);
  const lastStatus = useRef(status);
  const scroll = useRef<{ x: number; y: number } | null>(null);
  const rememberScroll = useCallback(() => { scroll.current = { x: window.scrollX, y: window.scrollY }; }, []);
  const close = useCallback(() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }, []);
  if (status !== previousStatus) { setPreviousStatus(status); setOpen(false); }
  useLayoutEffect(() => {
    if (status !== lastStatus.current) {
      trigger.current?.focus({ preventScroll: true });
      // The refreshed CTA/header can change document geometry. Restore the
      // submitted position after layout rather than relying on scroll anchoring.
      if (scroll.current) window.scrollTo(scroll.current.x, scroll.current.y);
      scroll.current = null;
    }
    lastStatus.current = status;
  }, [status]);

  if (status === "unavailable") return <div className="flex max-w-60 items-center gap-2 text-xs text-muted"><span role="status">{labels.unavailable}</span><button disabled={retrying} onClick={() => startRetry(() => retryAuth())} className="min-h-11 underline underline-offset-4">{labels.retry}</button></div>;
  return <div>
    {status === "authenticated" ? <form action={logoutAction} onSubmitCapture={rememberScroll} aria-busy={loggingOut}>
      <button ref={trigger} type="submit" disabled={loggingOut} className={`${buttonClass} border border-default`}>{loggingOut ? labels.loggingOut : labels.logout}</button>
      <span role="status" className="sr-only">{loggingOut ? labels.loggingOut : ""}</span>
      {logoutState.formError && <p role="alert" className="mt-2 max-w-60 text-xs">{labels.unavailable}</p>}
    </form> : <button ref={trigger} type="button" disabled={!ready} onClick={() => setOpen(true)} aria-haspopup="dialog" className={`${buttonClass} bg-accent text-on-accent`}>{labels.login}</button>}
    {open && status === "guest" && <LoginModal locale={locale} labels={labels} onClose={close} onSubmit={rememberScroll} />}
  </div>;
}

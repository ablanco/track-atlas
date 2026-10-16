"use client";

import { useActionState, useCallback, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { logout, retryAuth } from "@/app/[locale]/auth-actions";
import { LoginForm, type LoginLabels } from "./login-form";
import type { LogoutActionState } from "@/auth/logout-action";
import { UserMenu } from "./user-menu";
import { Modal } from "./modal";
import { PasswordRecoveryForm } from "./password-recovery-form";

export type AuthLabels = { login: string; logout: string; settings: string; loggingOut: string; unavailable: string; retry: string; close: string; form: LoginLabels };
const initialLogout: LogoutActionState = {};
const buttonClass = "min-h-11 rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-70";
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function LoginModal({ locale, labels, onClose, onSubmit, initialView = "login" }: { locale: string; labels: AuthLabels; onClose(): void; onSubmit(): void; initialView?: "login" | "recovery" }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(initialView), [email, setEmail] = useState("");
  const dismiss = onClose;
  const onPendingChange = useCallback((value: boolean) => { setBusy(value); }, []);
  return <Modal titleId={`${id}-title`} descriptionId={`${id}-description`} closeLabel={labels.close} busy={busy} onClose={dismiss} initialFocus='input[name="email"]'>
    {view === "recovery" ? <PasswordRecoveryForm locale={locale} email={email} titleId={`${id}-title`} descriptionId={`${id}-description`} onPendingChange={onPendingChange} onBack={value => { setEmail(value); setView("login"); }} /> :
    <LoginForm key="login" locale={locale} labels={labels.form} titleId={`${id}-title`} descriptionId={`${id}-description`} initialEmail={email}
      onForgotPassword={value => { setEmail(value); setView("recovery"); }} onPendingChange={onPendingChange} onSuccess={dismiss} onNavigate={dismiss} onSubmit={onSubmit} />}
  </Modal>;
}

type AuthControlProps = { status: "guest" | "authenticated" | "unavailable"; userName: string; locale: string; labels: AuthLabels };

export function AuthControl(props: AuthControlProps) {
  const pathname = usePathname();
  return <AuthControlState key={pathname} {...props} />;
}

function AuthControlState({ status, userName, locale, labels }: AuthControlProps) {
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
  return <div className="min-w-0 max-w-full">
    {status === "authenticated" ? <>
      <UserMenu name={userName} disabled={!ready || loggingOut} trigger={trigger}>
        <Link href="/settings" role="menuitem" tabIndex={-1} className={`${buttonClass} block w-full text-left hover:bg-background`}>{labels.settings}</Link>
        <form role="none" action={logoutAction} onSubmitCapture={rememberScroll}>
          <button role="menuitem" tabIndex={-1} type="submit" disabled={loggingOut} className={`${buttonClass} w-full text-left hover:bg-background`}>{loggingOut ? labels.loggingOut : labels.logout}</button>
        </form>
      </UserMenu>
      <span role="status" className="sr-only">{loggingOut ? labels.loggingOut : ""}</span>
      {logoutState.formError && <p role="alert" className="mt-2 max-w-60 text-xs">{labels.unavailable}</p>}
    </> : <button ref={trigger} type="button" disabled={!ready} onClick={() => setOpen(true)} aria-haspopup="dialog" className={`${buttonClass} bg-accent text-on-accent`}>{labels.login}</button>}
    {open && status === "guest" && <LoginModal locale={locale} labels={labels} onClose={close} onSubmit={rememberScroll} />}
  </div>;
}

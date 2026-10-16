"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LoginModal, type AuthLabels } from "./auth-control";
export function AccountAccessButton({ locale, initialView, labels }: { locale: string; initialView: "login" | "recovery"; labels: AuthLabels }) {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null), t = useTranslations("AccountEmails.ui");
  return <><button ref={trigger} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="mt-6 min-h-11 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-on-accent">{t(initialView === "login" ? "login" : "newLink")}</button>
    {open && <LoginModal locale={locale} labels={labels} initialView={initialView} onSubmit={() => {}} onClose={() => { setOpen(false); trigger.current?.focus({preventScroll:true}); }} />}</>;
}

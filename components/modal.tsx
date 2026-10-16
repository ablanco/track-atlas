"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

export function Modal({ children, titleId, descriptionId, closeLabel, busy, onClose, initialFocus, returnFocus }: {
  children: ReactNode; titleId: string; descriptionId?: string; closeLabel: string;
  busy: boolean; onClose(): void; initialFocus?: string; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    const restoreTarget = returnFocus?.current ?? previous;
    element?.showModal();
    const target = initialFocus ? element?.querySelector<HTMLElement>(initialFocus) : element;
    target?.focus({ preventScroll: true });
    return () => {
      element?.close();
      if (restoreTarget instanceof HTMLElement && restoreTarget.isConnected) restoreTarget.focus({ preventScroll: true });
    };
  }, [initialFocus, returnFocus]);

  return <dialog ref={dialog} tabIndex={-1} aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, a[href], select, textarea, [tabindex]'))
        .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
      if (!controls.length) { event.preventDefault(); return; }
      const target = event.shiftKey ? controls.at(-1) : controls[0];
      const boundary = event.shiftKey ? controls[0] : controls.at(-1);
      if (event.target === boundary || event.target === event.currentTarget) { event.preventDefault(); target?.focus({ preventScroll: true }); }
    }}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget || busy) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}
    className="fixed m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-default bg-surface p-6 text-primary shadow-md backdrop:bg-modal-backdrop sm:p-8">
    <button type="button" onClick={() => { if (!busy) onClose(); }} disabled={busy} aria-label={closeLabel} className="absolute top-3 right-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted disabled:cursor-wait disabled:opacity-70"><XIcon size={22} weight="regular" aria-hidden="true" /></button>
    {children}
  </dialog>;
}

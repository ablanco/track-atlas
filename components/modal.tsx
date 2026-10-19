"use client";

import { useRef, type ReactNode, type RefObject } from "react";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function Modal({
  children,
  titleId,
  descriptionId,
  closeLabel,
  busy,
  onClose,
  initialFocus,
  returnFocus,
}: {
  children: ReactNode;
  titleId: string;
  descriptionId?: string;
  closeLabel: string;
  busy: boolean;
  onClose(): void;
  initialFocus?: string;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      open
      disablePointerDismissal={busy}
      onOpenChange={(open, details) => {
        if (open) return;
        if (busy) details.cancel();
        else onClose();
      }}
    >
      <DialogContent
        ref={popup}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        showCloseButton={false}
        initialFocus={() =>
          initialFocus
            ? (popup.current?.querySelector<HTMLElement>(initialFocus) ?? true)
            : true
        }
        finalFocus={returnFocus ?? true}
        className="block max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto sm:p-8"
      >
        <DialogClose
          disabled={busy}
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3 min-h-11 min-w-11"
              aria-label={closeLabel}
            />
          }
        >
          <XIcon size={22} aria-hidden="true" />
        </DialogClose>
        {children}
      </DialogContent>
    </Dialog>
  );
}

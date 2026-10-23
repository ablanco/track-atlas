"use client";

import { useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/** Hover/focus names on desktop; tap to reveal them on touch screens. */
export function ExploreEntryHint({
  label,
  href,
  size = "sm",
  children,
}: {
  label: string;
  href?: string;
  size?: "sm" | "lg";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={100}
        onKeyUp={(event) => {
          // Open for keyboard navigation, without reopening on restored focus.
          if (event.key === "Tab") setOpen(true);
        }}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={
              size === "lg"
                ? "size-14 shrink-0 rounded-xl bg-muted p-0 text-foreground"
                : "size-8 shrink-0 rounded-full p-0 max-sm:min-h-11 max-sm:min-w-11"
            }
            aria-label={label}
          />
        }
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={6} className="z-50">
          <Popover.Popup
            initialFocus={false}
            aria-label={label}
            className="max-w-[calc(100vw-2rem)] rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
          >
            {href ? (
              <Link
                href={href}
                prefetch={false}
                className="break-words underline underline-offset-4"
              >
                {label}
              </Link>
            ) : (
              label
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

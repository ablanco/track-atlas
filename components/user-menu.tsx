"use client";

import {
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({
  name,
  avatarFileId,
  disabled,
  trigger,
  children,
}: {
  name: string;
  avatarFileId?: string | null;
  disabled: boolean;
  trigger: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Non-modal menus may retain pointer focus outside the popup. Tab still exits
  // the open menu, including when focus is on Base UI's portal guards.
  useLayoutEffect(() => {
    if (!open) return;
    const exitOnTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      setOpen(false);
      if (event.shiftKey) {
        event.preventDefault();
        trigger.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", exitOnTab, true);
    return () => document.removeEventListener("keydown", exitOnTab, true);
  }, [open, trigger]);
  return (
    <div className="min-w-0 max-w-full">
      <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              ref={trigger}
              type="button"
              variant="outline"
              disabled={disabled}
              className="min-h-11 max-w-full"
            />
          }
        >
          {avatarFileId && (
            <Avatar
              key={avatarFileId}
              size="sm"
              aria-hidden="true"
              className="hidden has-[img]:flex"
            >
              <AvatarImage
                src={`/api/avatars/${avatarFileId}?size=24`}
                alt=""
                width={24}
                height={24}
                loading="eager"
              />
            </Avatar>
          )}
          <span className="truncate">{name}</span>
          <CaretDownIcon size={16} aria-hidden="true" className="shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-40 max-w-[calc(100vw-2.5rem)]"
        >
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

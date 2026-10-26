"use client";

import {
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = [words[0], words.length > 1 ? words.at(-1) : undefined]
    .filter((word): word is string => !!word)
    .map((word) => Array.from(word)[0])
    .join("")
    .toUpperCase();
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
              className="min-h-11 max-w-full max-sm:size-11 max-sm:p-0"
              aria-label={name}
            />
          }
        >
          <Avatar
            key={avatarFileId ?? "initials"}
            size="sm"
            aria-hidden="true"
            className="max-sm:size-8"
          >
            {avatarFileId && (
              <AvatarImage
                src={`/api/avatars/${avatarFileId}?size=24`}
                alt=""
                width={24}
                height={24}
                loading="eager"
              />
            )}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden truncate sm:inline">{name}</span>
          <CaretDownIcon
            size={16}
            aria-hidden="true"
            className="hidden shrink-0 sm:block"
          />
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

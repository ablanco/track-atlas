"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import Image from "next/image";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";

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
  const [failedImageId, setFailedImageId] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const edge = useRef<"first" | "last">("first");
  const id = useId();
  useLayoutEffect(() => {
    if (open) {
      const element = menu.current;
      if (element) {
        const rect = element.getBoundingClientRect();
        const shift = Math.max(
          20 - rect.left,
          Math.min(0, window.innerWidth - 20 - rect.right),
        );
        element.style.transform = `translateX(${shift}px)`;
      }
      const items =
        menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      (edge.current === "last" ? items?.[items.length - 1] : items?.[0])?.focus(
        { preventScroll: true },
      );
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return (
    <div
      ref={container}
      className="relative min-w-0 max-w-full"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus({ preventScroll: true });
        }
      }}
    >
      <button
        ref={trigger}
        id={`${id}-toggle`}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => {
          edge.current = "first";
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            edge.current = event.key === "ArrowUp" ? "last" : "first";
            setOpen(true);
          }
        }}
        className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border border-default px-4 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-70"
      >
        {avatarFileId && failedImageId !== avatarFileId && (
          <Image
            key={avatarFileId}
            src={`/api/avatars/${avatarFileId}?size=24`}
            alt=""
            aria-hidden="true"
            width={24}
            height={24}
            unoptimized
            loading="eager"
            className="h-6 w-6 shrink-0 rounded-full object-cover"
            onError={() => setFailedImageId(avatarFileId)}
          />
        )}
        <span className="truncate">{name}</span>
        <CaretDownIcon
          size={16}
          weight="regular"
          aria-hidden="true"
          className="shrink-0"
        />
      </button>
      {open && (
        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-toggle`}
          onClick={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest('a[role="menuitem"]')
            ) {
              setOpen(false);
              trigger.current?.focus({ preventScroll: true });
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Tab" && event.shiftKey) {
              event.preventDefault();
              setOpen(false);
              trigger.current?.focus({ preventScroll: true });
              return;
            }
            const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
            if (!keys.includes(event.key)) return;
            event.preventDefault();
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                '[role="menuitem"]:not(:disabled)',
              ),
            );
            const current = items.indexOf(
              document.activeElement as HTMLElement,
            );
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (current +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length;
            items[next]?.focus({ preventScroll: true });
          }}
          className="absolute right-0 z-20 mt-2 min-w-40 max-w-[calc(100vw-2.5rem)] rounded-md border border-default bg-surface p-1 text-primary shadow-md"
        >
          {children}
        </div>
      )}
    </div>
  );
}

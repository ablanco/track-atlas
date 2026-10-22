"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Drawer } from "@base-ui/react/drawer";
import { FunnelIcon } from "@phosphor-icons/react/dist/csr/Funnel";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function ExploreFilterDrawer({
  children,
  disabled,
  active,
}: {
  children: ReactNode;
  disabled: boolean;
  active: boolean;
}) {
  const t = useTranslations("Explore");
  const auth = useTranslations("Auth");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  return (
    <Drawer.Root open={open} onOpenChange={setOpen} swipeDirection="down">
      <Drawer.Trigger
        render={
          <Button
            type="button"
            variant={active ? "secondary" : "outline"}
            disabled={disabled}
            className="shrink-0 lg:hidden"
          />
        }
      >
        <FunnelIcon aria-hidden="true" />
        {t("filters")}
        {active && (
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-current"
          />
        )}
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-end justify-center">
          <Drawer.Popup className="flex max-h-[90dvh] w-full flex-col rounded-t-2xl border bg-popover text-popover-foreground shadow-lg outline-none transition-transform duration-200 data-starting-style:translate-y-full data-ending-style:translate-y-full data-swiping:select-none data-swiping:duration-0 translate-y-(--drawer-swipe-movement-y)">
            <div
              aria-hidden="true"
              className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40"
            />
            <div className="flex shrink-0 items-center justify-between px-5 py-3">
              <Drawer.Title className="text-lg font-semibold">
                {t("filters")}
              </Drawer.Title>
              <Drawer.Close
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="min-h-11 min-w-11"
                  />
                }
                aria-label={auth("close")}
              >
                <XIcon aria-hidden="true" />
              </Drawer.Close>
            </div>
            <Drawer.Content className="grid gap-6 overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              {children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

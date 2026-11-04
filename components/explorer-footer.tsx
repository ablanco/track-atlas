"use client";

import {
  Suspense,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { DotsThreeCircleIcon } from "@phosphor-icons/react/dist/csr/DotsThreeCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { FooterNavigationContext } from "./footer-navigation-context";
import styles from "./explorer-footer.module.css";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function ExplorerFooter({ children }: { children: ReactNode }) {
  const t = useTranslations("ExplorerFooter");
  return (
    <div className={styles.entry}>
      <Suspense
        fallback={
          <Button
            disabled
            variant="outline"
            size="icon"
            className={styles.trigger}
            aria-label={t("title")}
          >
            <DotsThreeCircleIcon className="size-6" aria-hidden="true" />
          </Button>
        }
      >
        <ExplorerFooterRoute>{children}</ExplorerFooterRoute>
      </Suspense>
    </div>
  );
}

function ExplorerFooterRoute({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <ExplorerFooterState key={pathname}>{children}</ExplorerFooterState>;
}

function ExplorerFooterState({ children }: { children: ReactNode }) {
  const t = useTranslations("ExplorerFooter");
  const auth = useTranslations("Auth");
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const close = () => setOpen(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
        <TooltipProvider>
          <Tooltip open={!open && tooltipOpen} onOpenChange={setTooltipOpen}>
            <TooltipTrigger
              render={
                <DrawerTrigger
                  disabled={!ready}
                  render={
                    <Button
                      ref={trigger}
                      disabled={!ready}
                      variant="outline"
                      size="icon"
                    />
                  }
                />
              }
              disabled={!ready}
              aria-label={t("title")}
              className={styles.trigger}
            >
              <DotsThreeCircleIcon
                className="size-6"
                weight="regular"
                aria-hidden="true"
              />
            </TooltipTrigger>
            <TooltipContent side="top" align="start">
              {t("title")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DrawerContent
          finalFocus={trigger}
          data-explorer-footer-panel
          aria-describedby={undefined}
          className="max-h-[min(85dvh,36rem)]"
        >
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-3">
            <DrawerTitle className="text-lg font-semibold">
              {t("title")}
            </DrawerTitle>
            <DrawerClose
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0"
                />
              }
              aria-label={auth("close")}
            >
              <XIcon aria-hidden="true" />
            </DrawerClose>
          </div>
          <FooterNavigationContext value={close}>
            <div
              data-explorer-footer-controls
              className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-6 gap-y-3 overflow-y-auto overscroll-contain px-5 pt-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
              onClickCapture={(event) => {
                if ((event.target as HTMLElement).closest("a")) close();
              }}
            >
              {children}
            </div>
          </FooterNavigationContext>
        </DrawerContent>
      </Drawer>
    </>
  );
}

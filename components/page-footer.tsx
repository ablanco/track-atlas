"use client";

import type { ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";

/** Explorer pages reserve the available height for their map and results. */
export function PageFooter({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (
    pathname === "/tracks" ||
    /^\/users\/[^/]+\/tracks$/.test(pathname) ||
    /^\/lists\/[^/]+$/.test(pathname)
  )
    return null;

  return (
    <footer className="mt-auto flex w-full shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 sm:justify-end sm:px-8">
      {children}
    </footer>
  );
}

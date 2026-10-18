"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";

const subscribe = () => () => {};
const getMounted = () => true;
const getServerMounted = () => false;

export function ThemeSwitcher({
  labels,
}: {
  labels: { label: string; light: string; dark: string };
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, getMounted, getServerMounted);
  const dark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-label={labels.label}
      aria-checked={dark}
      title={mounted ? (dark ? labels.light : labels.dark) : labels.label}
      disabled={!mounted}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="relative inline-flex h-11 w-22 shrink-0 items-center justify-around rounded-full border border-default bg-surface text-primary outline-focus disabled:cursor-wait"
    >
      <span aria-hidden="true" className="absolute inset-y-1 left-1 w-9 rounded-full bg-surface-muted transition-transform motion-reduce:transition-none [[data-theme=dark]_&]:translate-x-11" />
      <SunIcon size={20} weight="regular" aria-hidden="true" focusable="false" className="relative" />
      <MoonIcon size={20} weight="regular" aria-hidden="true" focusable="false" className="relative" />
    </button>
  );
}

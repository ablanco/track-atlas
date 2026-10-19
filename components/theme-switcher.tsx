"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";
import { Switch } from "@/components/ui/switch";

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
    <div className="flex min-h-11 shrink-0 items-center gap-2 text-muted-foreground">
      <SunIcon size={18} aria-hidden="true" focusable="false" />
      <Switch
        nativeButton
        render={<button type="button" />}
        data-theme-switch
        aria-label={labels.label}
        title={mounted ? (dark ? labels.light : labels.dark) : labels.label}
        checked={dark}
        disabled={!mounted}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        className="border-muted-foreground data-unchecked:bg-muted-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-foreground dark:data-unchecked:bg-primary"
      />
      <MoonIcon size={18} aria-hidden="true" focusable="false" />
    </div>
  );
}

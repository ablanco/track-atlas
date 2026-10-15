"use client";

import { useId, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

const subscribe = () => () => {};
const getMounted = () => true;
const getServerMounted = () => false;

export function ThemeSwitcher({
  labels,
}: {
  labels: { label: string; light: string; dark: string; system: string };
}) {
  const id = useId();
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, getMounted, getServerMounted);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted">
        {labels.label}
      </label>
      <select
        id={id}
        className="rounded-md border border-default bg-surface px-3 py-2 text-sm text-primary outline-focus disabled:cursor-wait"
        disabled={!mounted}
        value={mounted ? theme : ""}
        onChange={(event) => setTheme(event.target.value)}
      >
        <option value="" disabled hidden />
        <option value="light">{labels.light}</option>
        <option value="dark">{labels.dark}</option>
        <option value="system">{labels.system}</option>
      </select>
    </div>
  );
}

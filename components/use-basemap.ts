"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

export type Basemap =
  "street" | "outdoor" | "dark" | "topographic" | "satellite";
const storageKey = "track-atlas-basemap";
const changeEvent = "track-atlas-basemap-change";
let memoryChoice: Basemap | null = null;
let memoryOnly = false;

export function isBasemap(value: unknown): value is Basemap {
  return (
    value === "street" ||
    value === "outdoor" ||
    value === "dark" ||
    value === "topographic" ||
    (value === "satellite" && !!process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN)
  );
}

function getChoice(): Basemap | null {
  if (memoryOnly) return memoryChoice;
  try {
    const value = localStorage.getItem(storageKey);
    return isBasemap(value) ? value : null;
  } catch {
    // Storage can be blocked. Keep manual choices for this page's lifetime.
    return memoryChoice;
  }
}

function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) {
      memoryOnly = false;
      memoryChoice = null;
      notify();
    }
  };
  window.addEventListener("storage", storage);
  window.addEventListener(changeEvent, notify);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(changeEvent, notify);
  };
}

function selectBasemap(value: Basemap) {
  if (!isBasemap(value)) return;
  memoryChoice = value;
  try {
    localStorage.setItem(storageKey, value);
    memoryOnly = false;
  } catch {
    // A preference write must not prevent selecting a basemap.
    memoryOnly = true;
  }
  window.dispatchEvent(new Event(changeEvent));
}

const serverChoice = () => null;

/** Theme defaults apply only until an explicit, browser-wide manual choice. */
export function useBasemap(): [Basemap, typeof selectBasemap] {
  const { resolvedTheme } = useTheme();
  const choice = useSyncExternalStore(subscribe, getChoice, serverChoice);
  const theme =
    resolvedTheme ??
    (typeof document === "undefined"
      ? undefined
      : document.documentElement.dataset.theme);
  return [choice ?? (theme === "dark" ? "dark" : "outdoor"), selectBasemap];
}

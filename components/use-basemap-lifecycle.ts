"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { ErrorEvent } from "maplibre-gl";
import { useLocale } from "next-intl";
import {
  BasemapLifecycle,
  type BasemapPolicy,
} from "@/tracks/basemap-lifecycle";
import { mapRequest } from "@/tracks/map-request";
import { useBasemap } from "./use-basemap";

/** MapLibre style binding and attempt-scoped events shared by both renderers. */
export function useBasemapLifecycle(policy: BasemapPolicy, active = true) {
  const locale = useLocale();
  const [choice, select] = useBasemap();
  const [lifecycle] = useState(
    () => new BasemapLifecycle(policy, choice, locale),
  );
  const state = useSyncExternalStore(
    lifecycle.subscribe,
    lifecycle.getSnapshot,
    lifecycle.getSnapshot,
  );
  useLayoutEffect(() => {
    lifecycle.select(choice, locale);
  }, [lifecycle, choice, locale]);
  useLayoutEffect(() => {
    if (!active) return;
    lifecycle.start();
    return () => lifecycle.stop();
  }, [lifecycle, active]);
  return {
    ...state,
    select,
    mapProps: {
      mapStyle: state.style,
      transformRequest: mapRequest,
      onLoad: () => lifecycle.event("load", state.attempt),
      onIdle: () => lifecycle.event("idle", state.attempt),
      onError: (event: ErrorEvent) =>
        lifecycle.event(
          "error",
          state.attempt,
          "sourceId" in event ? event.sourceId : undefined,
        ),
    },
  };
}

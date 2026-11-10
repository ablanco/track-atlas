import type { StyleSpecification } from "maplibre-gl";
import { createOutdoorStyle } from "./outdoor-style";
import { createSatelliteStyle } from "./satellite-style";
import { topographicStyle } from "./topographic-style";

export type Basemap =
  "street" | "outdoor" | "dark" | "topographic" | "satellite";
export type BasemapPolicy = "details" | "explorer";

type Snapshot = {
  basemap: Basemap;
  style: string | StyleSpecification;
  attempt: number;
  loaded: boolean;
  switching: boolean;
  fatal: boolean;
  failure: number | null;
};

/** Shared MapLibre basemap lifecycle; geometry and WebGL failures stay local. */
export class BasemapLifecycle {
  private state: Snapshot;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private listeners = new Set<() => void>();

  constructor(
    private policy: BasemapPolicy,
    basemap: Basemap,
    private locale: string,
  ) {
    this.state = {
      basemap,
      style: this.style(basemap),
      attempt: 0,
      loaded: false,
      switching: false,
      fatal: false,
      failure: null,
    };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(state: Snapshot) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private style(basemap: Basemap): Snapshot["style"] {
    switch (basemap) {
      case "outdoor":
        return createOutdoorStyle(this.locale);
      case "dark":
        return createOutdoorStyle(this.locale, "dark");
      case "topographic":
        return topographicStyle;
      case "satellite":
        return createSatelliteStyle(
          process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "",
        );
      case "street":
        return "https://tiles.openfreemap.org/styles/liberty";
    }
  }

  private deadline() {
    clearTimeout(this.timer);
    if (!this.active) return;
    this.timer = setTimeout(() => {
      const fatal =
        this.policy === "details" &&
        (!this.state.loaded || this.state.basemap === "street");
      this.publish({
        ...this.state,
        switching: false,
        fatal,
        failure: fatal ? null : this.state.attempt,
      });
    }, 25_000);
  }

  start() {
    this.active = true;
    this.deadline();
  }

  select(basemap: Basemap, locale: string) {
    if (basemap === this.state.basemap && locale === this.locale) return;
    this.locale = locale;
    if (
      basemap === this.state.basemap &&
      basemap !== "outdoor" &&
      basemap !== "dark"
    )
      return;
    this.publish({
      ...this.state,
      basemap,
      style: this.style(basemap),
      attempt: this.state.attempt + 1,
      switching: this.state.loaded,
      failure: null,
    });
    this.deadline();
  }

  event(event: "load" | "idle" | "error", attempt: number, sourceId?: unknown) {
    if (!this.active || attempt !== this.state.attempt) return;
    if (event === "error") {
      if (
        (sourceId === "outdoor" ||
          sourceId === "dark" ||
          sourceId === "topographic" ||
          sourceId === "satellite") &&
        sourceId !== this.state.basemap
      )
        return;
      if (this.state.failure !== null || this.state.fatal) return;
      const fatal =
        this.policy === "details" && this.state.basemap === "street";
      this.publish({
        ...this.state,
        fatal,
        failure: fatal ? null : this.state.attempt,
        switching: false,
      });
      // Initial details load must still complete before its deadline.
      if (this.state.loaded || this.policy === "explorer")
        clearTimeout(this.timer);
    } else if (event === "load") {
      this.publish({ ...this.state, loaded: true });
      clearTimeout(this.timer);
    } else if (this.state.loaded && this.state.switching) {
      this.publish({ ...this.state, switching: false });
      clearTimeout(this.timer);
    }
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.publish({
      ...this.state,
      attempt: this.state.attempt + 1,
      loaded: false,
      switching: false,
      fatal: false,
      failure: null,
    });
  }
}

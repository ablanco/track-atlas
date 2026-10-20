"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { MapFailure, MapLoading } from "./track-map-feedback";

const Renderer = dynamic(() => import("./track-map-renderer"), {
  ssr: false,
  loading: MapLoading,
});

class MapBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <MapFailure />;
    return this.props.children;
  }
}

/** No private geometry in the public shell or third-party requests. */
export function TrackMap({ id }: { id: string }) {
  const t = useTranslations("Tracks.map");
  return (
    <section aria-labelledby="track-map-heading" className="space-y-3">
      <h2 id="track-map-heading" className="text-xl font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("privacy")}</p>
      <p className="text-sm text-muted-foreground">{t("interaction")}</p>
      <MapBoundary key={id}>
        <Renderer key={id} id={id} />
      </MapBoundary>
    </section>
  );
}

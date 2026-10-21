"use client";

import dynamic from "next/dynamic";
import { Component, useId, type ReactNode } from "react";
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
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={headingId} className="text-xl font-semibold">
          {t("title")}
        </h2>
        <details className="max-w-prose text-sm text-muted-foreground">
          <summary className="min-h-11 cursor-pointer rounded-md py-3 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
            {t("help")}
          </summary>
          <div className="space-y-2 pb-3">
            <p>{t("privacy")}</p>
            <p>{t("interaction")}</p>
          </div>
        </details>
      </div>
      <MapBoundary key={id}>
        <Renderer key={id} id={id} />
      </MapBoundary>
    </section>
  );
}

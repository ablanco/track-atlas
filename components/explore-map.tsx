"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";
import type { ExploreMapProps } from "@/tracks/explore-types";
import { MapLoading } from "./track-map-feedback";
import { ExploreMapFailure } from "./explore-map-feedback";
import "./explore-map.css";

const Renderer = dynamic(() => import("./explore-map-renderer"), {
  ssr: false,
  loading: MapLoading,
});

class MapBoundary extends Component<
  { children: ReactNode; controls?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <ExploreMapFailure controls={this.props.controls} />
    ) : (
      this.props.children
    );
  }
}

/** Keep this boundary mounted across result changes to retain the basemap. */
export function ExploreMap(props: ExploreMapProps & { controls?: ReactNode }) {
  return (
    <MapBoundary controls={props.controls}>
      <Renderer {...props} />
    </MapBoundary>
  );
}

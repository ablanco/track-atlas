"use client";

import { Component, Suspense, lazy, type ReactNode } from "react";
import type { TrackChart } from "./track-charts-renderer";

const TrackChartsRenderer = lazy(() =>
  import("./track-charts-renderer").then((module) => ({
    default: module.TrackChartsRenderer,
  })),
);

class ChartErrorBoundary extends Component<
  { children: ReactNode; failure: string; retry: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed)
      return (
        <div role="alert" className="space-y-2 text-sm text-muted-foreground">
          <p>{this.props.failure}</p>
          <button
            type="button"
            className="min-h-11 rounded-md px-3 underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => window.location.reload()}
          >
            {this.props.retry}
          </button>
        </div>
      );
    return this.props.children;
  }
}

export function TrackCharts({
  charts,
  locale,
  failure,
  retry,
  loading,
}: {
  charts: TrackChart[];
  locale: string;
  failure: string;
  retry: string;
  loading: string;
}) {
  return (
    <ChartErrorBoundary failure={failure} retry={retry}>
      <Suspense fallback={<p role="status">{loading}</p>}>
        <TrackChartsRenderer charts={charts} locale={locale} />
      </Suspense>
    </ChartErrorBoundary>
  );
}

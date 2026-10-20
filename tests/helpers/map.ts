import { expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    recordedMapCoordinates?: number[][];
    recordedMapLoads?: number;
    activeMapWorkers?: number;
    startedMapWorkers?: number;
    stoppedMapWorkers?: number;
    removedWorkerMaps?: number;
  }
}

/** Stub only the external provider; retain real WebGL, workers and GeoJSON. */
export async function stubBasemap(page: Page) {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {
          provider: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
            attribution:
              '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
          },
        },
        layers: [
          { id: "provider", type: "circle", source: "provider" },
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#f0f0f0" },
          },
        ],
      },
    }),
  );
  // Observe the actual data sent across the renderer's browser-worker boundary,
  // not a test-only production hook or a replacement renderer.
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      private tracked: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.tracked = String(url).startsWith("blob:");
        if (this.tracked) {
          window.activeMapWorkers = (window.activeMapWorkers ?? 0) + 1;
          window.startedMapWorkers = (window.startedMapWorkers ?? 0) + 1;
        }
      }
      terminate() {
        if (this.tracked) {
          window.activeMapWorkers!--;
          window.stoppedMapWorkers = (window.stoppedMapWorkers ?? 0) + 1;
          this.tracked = false;
        }
        super.terminate();
      }
    };
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message: {
        type?: string;
        data?: {
          source?: string;
          data?: { geometry?: { coordinates: number[][] } };
        };
      },
      ...args: unknown[]
    ) {
      // Pinned MapLibre's removeMap message releases per-map worker data.
      if (message?.type === "RM")
        window.removedWorkerMaps = (window.removedWorkerMaps ?? 0) + 1;
      if (
        message?.data?.source === "recorded-path" &&
        message.data.data?.geometry
      ) {
        window.recordedMapCoordinates = message.data.data.geometry.coordinates;
        window.recordedMapLoads = (window.recordedMapLoads ?? 0) + 1;
      }
      return Reflect.apply(send, this, [message, ...args]);
    };
  });
}

export async function mapCoordinates(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.recordedMapCoordinates?.length ?? 0))
    .toBeGreaterThan(1);
  return page.evaluate(() => window.recordedMapCoordinates!);
}

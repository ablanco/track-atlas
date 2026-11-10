import { defineConfig, devices } from "@playwright/test";

/** Browser seam for the map component: fixture props, real renderer and workers. */
export default defineConfig({
  testDir: "./tests/browser-map",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3108",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    env: { NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: "pk.browser-map-fixture" },
    command:
      "pnpm exec next dev tests/fixtures/explore-map --hostname 127.0.0.1 --port 3108",
    url: "http://127.0.0.1:3108",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  distDir: process.env.EMAIL_TEST_METADATA ? ".next-e2e" : ".next",
  allowedDevOrigins: ["127.0.0.1"],
  // Retain native Node worker assets as well as Turbopack's generated worker chunks.
  outputFileTracingIncludes: {
    "/api/tracks": [
      "./tracks/gpx-*.cjs",
      "./node_modules/saxes/**/*",
      "./node_modules/xmlchars/**/*",
      "./node_modules/geographiclib-geodesic/**/*",
    ],
  },
  experimental: {
    agentFeedback: true,
    agentUpgrade: "security",
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        // Let Next handle CSS Modules natively; the Tailwind loader emits global CSS.
        condition: { not: { path: "*.module.css" } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);

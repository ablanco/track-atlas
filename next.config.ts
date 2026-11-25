import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  distDir: process.env.EMAIL_TEST_METADATA ? ".next-e2e" : ".next",
  // Reserve the bottom-left corner for the explorer footer, including local previews.
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "local.mensab.com"],
  // Temporary GPX capabilities are bearer secrets, including in development.
  logging: {
    incomingRequests: {
      ignore: [
        /\/api\/tracks\/[^/]+\/gpx-studio\//,
        /\/digest-opt-out(?:[/?]|$)/,
      ],
    },
  },
  // Retain native Node worker assets as well as Turbopack's generated worker chunks.
  outputFileTracingIncludes: {
    "/*/tracks/*": ["./node_modules/geo-tz/data/**/*"],
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
  serverExternalPackages: ["geo-tz"],
  cacheComponents: true,
  partialPrefetching: true,
  // Keep production metadata in the initial head for every HTML consumer.
  // Next 16.4.6's dev shell validation fails with dynamic metadata when
  // streaming is disabled for all user agents; retain its default in dev.
  htmlLimitedBots: process.env.NODE_ENV === "development" ? undefined : /.*/,
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

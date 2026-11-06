/* eslint-disable @typescript-eslint/no-require-imports -- Native Node worker asset must run without a bundler or TS loader. */
"use strict";
// Native Node entrypoint. Keep this and gpx-engine.cjs in the Next output trace;
// no source-only TypeScript execution hooks are inherited by the worker.
const { parentPort, workerData } = require("node:worker_threads");
const {
  parseGpx,
  parseGpxDocument,
  parseGpxWaypoints,
} = require("./gpx-engine.cjs");
try {
  parentPort.postMessage({
    result: (workerData.document === "waypoints"
      ? parseGpxWaypoints
      : workerData.document
        ? parseGpxDocument
        : parseGpx)(workerData.bytes),
  });
} catch (error) {
  parentPort.postMessage({
    code: typeof error?.code === "string" ? error.code : "invalidFile",
    ...(typeof error?.track === "number" &&
    Number.isInteger(error.track) &&
    error.track >= 1 &&
    error.track <= 100
      ? { track: error.track }
      : {}),
    ...(error?.code === "invalidSegment" &&
    typeof error.segment === "number" &&
    Number.isInteger(error.segment) &&
    error.segment >= 1 &&
    error.segment <= 100
      ? { segment: error.segment }
      : {}),
  });
}

/* eslint-disable @typescript-eslint/no-require-imports -- Native Node worker asset must run without a bundler or TS loader. */
"use strict";
// Native Node entrypoint. Keep this and gpx-engine.cjs in the Next output trace;
// no source-only TypeScript execution hooks are inherited by the worker.
const { parentPort, workerData } = require("node:worker_threads");
const { parseGpx } = require("./gpx-engine.cjs");
try {
  parentPort.postMessage({ result: parseGpx(workerData.bytes) });
} catch (error) {
  parentPort.postMessage({
    code: typeof error?.code === "string" ? error.code : "invalidFile",
  });
}

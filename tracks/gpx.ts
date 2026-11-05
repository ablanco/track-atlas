import { join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  parseGpx as parse,
  parseGpxDocument as parseDocument,
} from "./gpx-engine.cjs";
import { TrackError } from "./validation";
import { parserError } from "./gpx-errors";
import { GPX_LIMITS } from "./gpx-document.cjs";

import type { TrackDataPayload, TrackLineString } from "./geometry";

export type GpxLineString = TrackLineString;
export type ProcessedGpx = TrackDataPayload & {
  segmentCount: number;
  distanceMeters: number;
  durationSeconds: number | null;
  ascentMeters: number | null;
  descentMeters: number | null;
  minElevationMeters: number | null;
  maxElevationMeters: number | null;
  elevationSampleCount: number;
  pointCount: number;
  representations: {
    segmentIndex: number;
    intermediateCount: number;
    geometry: GpxLineString;
    directionlessEdges: boolean[];
  }[];
  version: 2;
};

export type ProcessedGpxDocument = {
  tracks: { trackIndex: number; data: ProcessedGpx; gpx: Uint8Array }[];
};

export function parseGpxDocument(bytes: Uint8Array): ProcessedGpxDocument {
  try {
    return parseDocument(bytes);
  } catch (error) {
    throw parserError(error);
  }
}

export function processGpxDocument(
  bytes: Uint8Array,
): Promise<ProcessedGpxDocument> {
  return runWorker(bytes, true) as Promise<ProcessedGpxDocument>;
}

/** Pure known-answer seam. Request handlers must use processGpx instead. */
export function parseGpx(bytes: Buffer): ProcessedGpx {
  try {
    return parse(bytes);
  } catch (error) {
    throw parserError(error);
  }
}

const deadlineMilliseconds = 10_000;
let activeWorkers = 0;

/**
 * Wall deadline includes startup/derivation/result copying and interrupts CPU work.
 * At most two workers per application process; excess work is rejected, not queued.
 * V8 heap/stack limits plus the byte/point/element bounds constrain memory; external
 * input and output allocations are independently bounded by those cardinalities.
 * Keep worker assets/dependencies in the route trace. Native Node loads the CJS
 * entry directly; Turbopack may emit its own worker chunk. Neither requires a TS loader.
 */
export function processGpx(bytes: Buffer): Promise<ProcessedGpx> {
  return runWorker(bytes, false) as Promise<ProcessedGpx>;
}

async function runWorker(
  bytes: Uint8Array,
  document: boolean,
): Promise<ProcessedGpx | ProcessedGpxDocument> {
  if (bytes.byteLength > GPX_LIMITS.bytes) throw new TrackError("tooLarge");
  if (activeWorkers >= 2) throw new TrackError("processingTimeout");
  activeWorkers++;
  const started = performance.now();
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Exact-size owned copy, never transfer a Buffer pool or the caller's original.
    const input = Uint8Array.from(bytes);
    worker = new Worker(join(process.cwd(), "tracks", "gpx-worker.cjs"), {
      // Turbopack merges forwarded globals into workerData. Keep transferable
      // binary data nested so both native Node and bundled workers preserve it.
      workerData: { bytes: input, document },
      transferList: [input.buffer],
      execArgv: [],
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    });
    return await new Promise<ProcessedGpx | ProcessedGpxDocument>(
      (resolve, reject) => {
        timer = setTimeout(
          () => {
            // terminate() interrupts even an infinite synchronous parser loop.
            void worker!.terminate();
            reject(new TrackError("processingTimeout"));
          },
          Math.max(0, deadlineMilliseconds - (performance.now() - started)),
        );
        worker!.once(
          "message",
          (message: {
            result?: ProcessedGpx | ProcessedGpxDocument;
            code?: string;
          }) => {
            if (performance.now() - started >= deadlineMilliseconds)
              reject(new TrackError("processingTimeout"));
            else if (message.result) resolve(message.result);
            else reject(parserError(message));
          },
        );
        worker!.once("error", () =>
          reject(new TrackError("processingTimeout")),
        );
        worker!.once("exit", () => reject(new TrackError("processingTimeout")));
      },
    );
  } finally {
    if (timer) clearTimeout(timer);
    if (worker) await worker.terminate();
    activeWorkers--;
  }
}

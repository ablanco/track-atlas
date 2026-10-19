import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { parseGpx as parse } from "./gpx-engine.cjs";
import { TrackError, type TrackErrorCode } from "./validation";

export type GpxLineString = {
  type: "LineString";
  coordinates: [number, number][];
};
export type ProcessedGpx = {
  geometry: GpxLineString;
  samples: {
    distanceMeters: number;
    elevationMeters: number | null;
    speedMps: number | null;
  }[];
  distanceMeters: number;
  durationSeconds: number | null;
  ascentMeters: number | null;
  descentMeters: number | null;
  minElevationMeters: number | null;
  maxElevationMeters: number | null;
  elevationSampleCount: number;
  pointCount: number;
  representations: {
    intermediateCount: number;
    geometry: GpxLineString;
    directionlessEdges: boolean[];
  }[];
  version: 1;
};

const parserCodes = new Set<TrackErrorCode>([
  "invalidFile",
  "unsupportedStructure",
  "tooLarge",
  "tooManyPoints",
  "processingTimeout",
]);

function parserError(error: unknown): TrackError {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  return new TrackError(
    typeof code === "string" && parserCodes.has(code as TrackErrorCode)
      ? (code as TrackErrorCode)
      : "invalidFile",
  );
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
export async function processGpx(bytes: Buffer): Promise<ProcessedGpx> {
  if (bytes.byteLength > 10 * 1024 * 1024) throw new TrackError("tooLarge");
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
      workerData: { bytes: input },
      transferList: [input.buffer],
      execArgv: [],
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    });
    return await new Promise<ProcessedGpx>((resolve, reject) => {
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
        (message: { result?: ProcessedGpx; code?: string }) => {
          if (performance.now() - started >= deadlineMilliseconds)
            reject(new TrackError("processingTimeout"));
          else if (message.result) resolve(message.result);
          else reject(parserError(message));
        },
      );
      worker!.once("error", () => reject(new TrackError("processingTimeout")));
      worker!.once("exit", () => reject(new TrackError("processingTimeout")));
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (worker) await worker.terminate();
    activeWorkers--;
  }
}

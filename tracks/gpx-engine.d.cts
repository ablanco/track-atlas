export function parseGpx(bytes: Uint8Array): import("./gpx").ProcessedGpx;

export function parseGpxDocument(
  bytes: Uint8Array,
): import("./gpx").ProcessedGpxDocument;

export function parseGpxWaypoints(
  bytes: Uint8Array,
): import("./geometry").TrackWaypoint[];

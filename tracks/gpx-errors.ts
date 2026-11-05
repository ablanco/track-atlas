import { TrackError, type TrackErrorCode } from "./validation";

const parserCodes = new Set<TrackErrorCode>([
  "invalidFile",
  "invalidSegment",
  "unsupportedStructure",
  "tooLarge",
  "tooManyPoints",
  "tooManySegments",
  "tooManyTracks",
  "processingTimeout",
]);

export function parserError(error: unknown): TrackError {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  return new TrackError(
    typeof code === "string" && parserCodes.has(code as TrackErrorCode)
      ? (code as TrackErrorCode)
      : "invalidFile",
    undefined,
    {
      track:
        error && typeof error === "object" && "track" in error
          ? error.track
          : undefined,
      segment:
        error && typeof error === "object" && "segment" in error
          ? error.segment
          : undefined,
    },
  );
}

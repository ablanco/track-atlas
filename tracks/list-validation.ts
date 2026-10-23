import type { TrackListErrorCode } from "./list-types";
export class TrackListError extends Error {
  constructor(public code: TrackListErrorCode) {
    super(code);
  }
}
export function listName(input: unknown): {
  name: string;
  normalizedName: string;
} {
  if (typeof input !== "object" || !input || Array.isArray(input))
    throw new TrackListError("invalidRequest");
  const name = (input as { name?: unknown }).name;
  if (typeof name !== "string") throw new TrackListError("invalidRequest");
  const trimmed = name.trim().normalize("NFC");
  if (!trimmed || [...trimmed].length > 100)
    throw new TrackListError("invalidRequest");
  return { name: trimmed, normalizedName: trimmed.toLowerCase() };
}

import { scanGpx, GPX_LIMITS } from "./gpx-document.cjs";
import { parserError } from "./gpx-errors";
import { TrackError } from "./validation";

export { GPX_LIMITS };

/** Input title is already metadata-validated by the caller; singleton is unchanged. */
export function generateTrackTitles(
  title: string,
  trackCount: number,
): string[] {
  if (
    !Number.isInteger(trackCount) ||
    trackCount < 1 ||
    trackCount > GPX_LIMITS.tracks
  )
    throw new TrackError("invalidRequest");
  if (trackCount === 1) return [title];
  const base = Array.from(title);
  return Array.from({ length: trackCount }, (_, index) => {
    const suffix = ` ${index + 1}`;
    return base.slice(0, 200 - suffix.length).join("") + suffix;
  });
}

export type GpxUploadPreview = {
  trackCount: number;
  titles: string[];
  firstPhotoTrackIndex: 0;
};

/** Bounded structural preview, without geodesic derivation or Node dependencies.
 * Not server validation: positive segment length and derived metrics are checked
 * independently by processGpxDocument. Suitable for a browser Web Worker.
 */
export function previewGpxUpload(
  bytes: Uint8Array,
  title: string,
): GpxUploadPreview {
  try {
    const trackCount = scanGpx(bytes).tracks.length;
    return {
      trackCount,
      titles: generateTrackTitles(title, trackCount),
      firstPhotoTrackIndex: 0,
    };
  } catch (error) {
    throw parserError(error);
  }
}

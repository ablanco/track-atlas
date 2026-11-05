export const GPX_LIMITS: Readonly<{
  bytes: number;
  tracks: number;
  segments: number;
  points: number;
  elements: number;
  depth: number;
}>;
export function scanGpx(bytes: Uint8Array): {
  tracks: {
    coordinates: number[][];
    segmentStarts: number[];
    elevations: (number | null)[];
    times: (number | null)[];
    segments: number;
    xml: string;
  }[];
};

import { Geodesic } from "geographiclib-geodesic";
import type { ExplorePosition } from "./explore-types";

/** Shared finite WGS84 path. Equal-distance pieces are at most 1 km long;
 * even a near-antipodal drawing has at most 20,005 vertices. Keep the exact
 * endpoints for finite inclusive distance and local endpoint bearings.
 * A visualization-only segment budget can make transient previews coarser;
 * callers without a budget retain the exact shared search sampling.
 */
export function sampleExplorePath(
  start: ExplorePosition,
  end: ExplorePosition,
  maxSegments = Infinity,
) {
  const earth = Geodesic.WGS84;
  const inverse = earth.Inverse(start[1], start[0], end[1], end[0]);
  const count = Math.max(
    1,
    Math.min(Math.floor(maxSegments), Math.ceil(inverse.s12! / 1000)),
  );
  const samples = Array.from({ length: count + 1 }, (_, i) => {
    const point = earth.Direct(
      start[1],
      start[0],
      inverse.azi1!,
      (inverse.s12! * i) / count,
    );
    const position =
      i === 0
        ? start
        : i === count
          ? end
          : ([point.lon2!, point.lat2!] as ExplorePosition);
    return {
      position,
      azimuth:
        i === 0 ? inverse.azi1! : i === count ? inverse.azi2! : point.azi2!,
    };
  });
  return { samples, finalAzimuth: inverse.azi2! };
}

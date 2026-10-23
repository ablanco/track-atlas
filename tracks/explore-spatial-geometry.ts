import { Geodesic } from "geographiclib-geodesic";
import type { ExploreDrawing, ExplorePosition } from "./explore-types";

const earth = Geodesic.WGS84;
const mercatorLimit = 85.051129;

function unwrap(points: ExplorePosition[], anchor: number): ExplorePosition[] {
  let previous = anchor;
  return points.map(([longitude, latitude]) => {
    const lon = longitude + 360 * Math.round((previous - longitude) / 360);
    previous = lon;
    return [lon, latitude];
  });
}

/** Clip the sampled geographic ring at Mercator's horizon, rather than folding it. */
function clipPolar(ring: ExplorePosition[]): ExplorePosition[] {
  for (const sign of [-1, 1]) {
    const output: ExplorePosition[] = [];
    let previous = ring[ring.length - 1];
    for (const point of ring) {
      const inside = point[1] * sign <= mercatorLimit;
      if (inside !== previous[1] * sign <= mercatorLimit) {
        const ratio =
          (sign * mercatorLimit - previous[1]) / (point[1] - previous[1]);
        output.push([
          previous[0] + ratio * (point[0] - previous[0]),
          sign * mercatorLimit,
        ]);
      }
      if (inside) output.push(point);
      previous = point;
    }
    ring = output;
    if (!ring.length) return [];
  }
  return [...ring, ring[0]];
}

/** Browser-only visualization; authoritative matching remains spheroidal PostGIS. */
export function exploreDrawingGeometry(drawing: ExploreDrawing) {
  const { start, end, corridorKm } = drawing;
  const inverse = earth.Inverse(start[1], start[0], end[1], end[0]);
  const distance = inverse.s12!;
  const bearing = inverse.azi1!;
  // At most 1024 side samples, with <=20 km spacing even for near-antipodal paths.
  const count = Math.max(1, Math.min(1024, Math.ceil(distance / 20_000)));
  const samples = Array.from({ length: count + 1 }, (_, i) =>
    earth.Direct(start[1], start[0], bearing, (distance * i) / count),
  );
  const offset = (
    lat: number,
    lon: number,
    azimuth: number,
  ): ExplorePosition => {
    const point = earth.Direct(lat, lon, azimuth, corridorKm * 1000);
    return [point.lon2!, point.lat2!];
  };
  const left = samples.map((p) => offset(p.lat2!, p.lon2!, p.azi2! - 90));
  const right = samples.map((p) => offset(p.lat2!, p.lon2!, p.azi2! + 90));
  const cap = (position: ExplorePosition, azimuth: number) =>
    Array.from({ length: 37 }, (_, i) =>
      offset(position[1], position[0], azimuth + i * 5),
    );
  const raw = [
    ...left,
    ...cap(end, inverse.azi2! - 90),
    ...right.reverse(),
    ...cap(start, bearing + 90),
  ];
  const ring = unwrap(raw, start[0]);
  // A polar cap can wind once around the globe. Close it along its geographic pole.
  if (Math.abs(ring[ring.length - 1][0] - ring[0][0]) > 180) {
    const pole = ring.reduce((sum, p) => sum + p[1], 0) > 0 ? 90 : -90;
    ring.push([ring[ring.length - 1][0], pole], [ring[0][0], pole]);
  }
  const corridor = clipPolar(ring);
  const line = unwrap(
    samples.map((p) => [
      p.lon2!,
      Math.max(-mercatorLimit, Math.min(mercatorLimit, p.lat2!)),
    ]),
    start[0],
  );
  const bounds = [...line, ...corridor].reduce<
    [[number, number], [number, number]]
  >(
    (b, p) => [
      [Math.min(b[0][0], p[0]), Math.min(b[0][1], p[1])],
      [Math.max(b[1][0], p[0]), Math.max(b[1][1], p[1])],
    ],
    [
      [Infinity, Infinity],
      [-Infinity, -Infinity],
    ],
  );
  return {
    line,
    corridor,
    bounds,
    finalAzimuth: inverse.azi2!,
    polar: raw.some((p) => Math.abs(p[1]) > mercatorLimit),
  };
}

import type { TrackMultiLineString } from "./geometry";
export type ExploreGeometry = TrackMultiLineString;

/** Align the page to one world copy without changing recorded source positions. */
export function prepareExplorePaths(
  tracks: { id: string; geometry: ExploreGeometry }[],
  referenceLongitude?: number,
) {
  let anchor = referenceLongitude;
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity;
  const paths = tracks.map(({ id, geometry }) => {
    const coordinates = geometry.coordinates.map((part) => {
      let previous = part[0][0];
      if (anchor === undefined) anchor = previous;
      const shift = 360 * Math.round((anchor - previous) / 360);
      return part.map(([lon, lat]): [number, number] => {
        const longitude = lon + 360 * Math.round((previous - lon) / 360);
        previous = longitude;
        const aligned = longitude + shift;
        west = Math.min(west, aligned);
        east = Math.max(east, aligned);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
        return [aligned, lat];
      });
    });
    return { id, geometry: { type: "MultiLineString" as const, coordinates } };
  });
  const clamp = (lat: number) => Math.max(-85.051129, Math.min(85.051129, lat));
  return {
    paths,
    bounds: paths.length
      ? ([
          [west, clamp(south)],
          [east, clamp(north)],
        ] as [[number, number], [number, number]])
      : null,
    polar: paths.length > 0 && (south < -85.051129 || north > 85.051129),
  };
}

/** Validate the server's geometry-only response before passing it to WebGL. */
export function readExploreGeometry(data: unknown): ExploreGeometry {
  return readTrackGeometry(data, 2048);
}

/** Details retain every original position; explorer has a smaller total budget. */
export function readTrackGeometry(
  data: unknown,
  maxPoints = 100_000,
): TrackMultiLineString {
  const geometry = (data as { geometry?: TrackMultiLineString } | null)
    ?.geometry;
  if (
    geometry?.type !== "MultiLineString" ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length < 1 ||
    geometry.coordinates.length > 100 ||
    geometry.coordinates.some(
      (part) =>
        !Array.isArray(part) ||
        part.length < 2 ||
        part.some(
          (point) =>
            !Array.isArray(point) ||
            point.length !== 2 ||
            !Number.isFinite(point[0]) ||
            !Number.isFinite(point[1]) ||
            Math.abs(point[0]) > 180 ||
            Math.abs(point[1]) > 90,
        ),
    ) ||
    geometry.coordinates.reduce((total, part) => total + part.length, 0) >
      maxPoints
  )
    throw Error("Invalid track geometry");
  return geometry;
}

/** Zero-based palette slot. Callers retain each track's slot while it stays visible. */
export function getExploreTrackColor(index: number): string {
  return `var(--explore-path-${(((Math.trunc(index) % 10) + 10) % 10) + 1})`;
}

/** Group coincident markers so every endpoint remains reachable on touch screens. */
export function prepareTrackEndpoints(
  original: TrackMultiLineString,
  display: TrackMultiLineString,
) {
  type Endpoint = { segment: number; kind: "start" | "end" | "startEnd" };
  const groups = new Map<
    string,
    { position: [number, number]; endpoints: Endpoint[] }
  >();
  display.coordinates.forEach((part, index) => {
    const recorded = original.coordinates[index];
    const first = part[0];
    const last = part.at(-1)!;
    const loop =
      recorded[0][0] === recorded.at(-1)![0] &&
      recorded[0][1] === recorded.at(-1)![1];
    const add = (position: [number, number], kind: Endpoint["kind"]) => {
      const key = position.join(",");
      const group = groups.get(key) ?? { position, endpoints: [] };
      group.endpoints.push({ segment: index + 1, kind });
      groups.set(key, group);
    };
    add(first, loop ? "startEnd" : "start");
    if (!loop) add(last, "end");
  });
  return [...groups.values()];
}

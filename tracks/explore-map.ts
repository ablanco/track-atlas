export type ExploreGeometry = {
  type: "LineString";
  coordinates: [number, number][];
};

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
    let previous = geometry.coordinates[0][0];
    if (anchor === undefined) anchor = previous;
    const shift = 360 * Math.round((anchor - previous) / 360);
    const coordinates = geometry.coordinates.map(
      ([lon, lat]): [number, number] => {
        const longitude = lon + 360 * Math.round((previous - lon) / 360);
        previous = longitude;
        const aligned = longitude + shift;
        west = Math.min(west, aligned);
        east = Math.max(east, aligned);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
        return [aligned, lat];
      },
    );
    return { id, geometry: { type: "LineString" as const, coordinates } };
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
  const geometry = (data as { geometry?: ExploreGeometry } | null)?.geometry;
  if (
    geometry?.type !== "LineString" ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length < 2 ||
    geometry.coordinates.length > 100_000 ||
    geometry.coordinates.some(
      (point) =>
        !Array.isArray(point) ||
        point.length !== 2 ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1]) ||
        Math.abs(point[0]) > 180 ||
        Math.abs(point[1]) > 90,
    )
  )
    throw Error("Invalid explorer geometry");
  return geometry;
}

/** Zero-based palette slot. Callers retain each track's slot while it stays visible. */
export function getExploreTrackColor(index: number): string {
  return `var(--explore-path-${(((Math.trunc(index) % 10) + 10) % 10) + 1})`;
}

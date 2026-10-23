import type {
  ExploreFilters,
  ExploreViewport,
  ExploreDrawing,
  ExplorePosition,
} from "./explore-types";
import { activityTypes, type ActivityType, TrackError } from "./validation";

/** Shared by browser navigation and the read-only HTTP adapter. */
export function parseExploreFilters(params: URLSearchParams): ExploreFilters {
  const allowed = [
    "q",
    "activity",
    "difficulty",
    "minDistance",
    "maxDistance",
    "maxElevationRange",
    "visibility",
    "page",
    "viewport",
    "drawMode",
    "drawStart",
    "drawEnd",
    "corridorKm",
  ];
  if (
    params.toString().length > 4096 ||
    [...params.keys()].some((key) => !allowed.includes(key)) ||
    allowed
      .filter((key) => key !== "activity" && key !== "difficulty")
      .some((key) => params.getAll(key).length > 1)
  )
    throw new TrackError("invalidRequest");
  const decimal = (key: string) => {
    if (!params.has(key)) return null;
    const value = params.get(key)!;
    const number = Number(value);
    if (
      !/^\d+(?:\.\d+)?$/.test(value) ||
      !Number.isFinite(number) ||
      number > 1e9
    )
      throw new TrackError("invalidRequest");
    return number;
  };
  const min = decimal("minDistance"),
    max = decimal("maxDistance"),
    elevation = decimal("maxElevationRange");
  const page = decimal("page") ?? 1;
  const q = (params.get("q") ?? "").trim().replace(/\s+/gu, " ");
  const visibility = params.get("visibility") ?? "all";
  if (
    Array.from(q).length > 200 ||
    q.includes("\0") ||
    !["all", "public", "private"].includes(visibility) ||
    !Number.isInteger(page) ||
    page < 1 ||
    (min !== null && max !== null && min > max) ||
    params
      .getAll("activity")
      .some((value) => !activityTypes.includes(value as ActivityType)) ||
    params.getAll("difficulty").some((value) => !/^[1-5]$/.test(value))
  )
    throw new TrackError("invalidRequest");
  return {
    q,
    activities: [
      ...new Set(params.getAll("activity")),
    ].sort() as ActivityType[],
    difficulties: [...new Set(params.getAll("difficulty").map(Number))].sort(
      (a, b) => a - b,
    ),
    minDistanceKm: min,
    maxDistanceKm: max,
    maxElevationRangeMeters: elevation,
    visibility: visibility as ExploreFilters["visibility"],
    page,
    ...parseSpatialFilters(params),
  };
}
export function serializeExploreFilters(
  filters: ExploreFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  for (const value of [...new Set(filters.activities)].sort())
    params.append("activity", value);
  for (const value of [...new Set(filters.difficulties)].sort((a, b) => a - b))
    params.append("difficulty", String(value));
  if (filters.minDistanceKm !== null)
    params.set("minDistance", String(filters.minDistanceKm));
  if (filters.maxDistanceKm !== null)
    params.set("maxDistance", String(filters.maxDistanceKm));
  if (filters.maxElevationRangeMeters !== null)
    params.set("maxElevationRange", String(filters.maxElevationRangeMeters));
  if (filters.visibility !== "all")
    params.set("visibility", filters.visibility);
  if (filters.page !== 1) params.set("page", String(filters.page));
  if (filters.viewport) {
    const { west, south, east, north } = filters.viewport;
    params.set("viewport", [west, south, east, north].join(","));
  }
  if (filters.drawing) {
    params.set("drawMode", filters.drawing.mode);
    params.set("drawStart", filters.drawing.start.join(","));
    params.set("drawEnd", filters.drawing.end.join(","));
    params.set("corridorKm", String(filters.drawing.corridorKm));
  }
  return params;
}

function parseSpatialFilters(params: URLSearchParams): {
  viewport: ExploreViewport | null;
  drawing: ExploreDrawing | null;
} {
  const invalid = () => {
    throw new TrackError("invalidRequest");
  };
  const tuple = (key: string, length: number) => {
    const values = params.get(key)?.split(",") ?? [];
    if (
      values.length !== length ||
      values.some(
        (value) =>
          !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) ||
          !Number.isFinite(Number(value)),
      )
    )
      invalid();
    return values.map(Number);
  };
  const position = (key: string): ExplorePosition => {
    const [lon, lat] = tuple(key, 2);
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) invalid();
    return [lon === 180 ? -180 : lon, lat];
  };
  let viewport: ExploreViewport | null = null;
  if (params.has("viewport")) {
    const [west, south, east, north] = tuple("viewport", 4);
    if (
      Math.abs(west) > 180 ||
      Math.abs(east) > 180 ||
      south < -90 ||
      north > 90 ||
      south >= north ||
      west === east ||
      (west === 180 && east === -180)
    )
      invalid();
    viewport = { west, south, east, north };
  }
  let drawing: ExploreDrawing | null = null;
  if (
    ["drawMode", "drawStart", "drawEnd", "corridorKm"].some((key) =>
      params.has(key),
    )
  ) {
    const mode = params.get("drawMode");
    if (mode !== "arrow" && mode !== "line") invalid();
    const start = position("drawStart"),
      end = position("drawEnd");
    const longitudeDifference = Math.abs(start[0] - end[0]);
    // Longitude is immaterial at the poles; +/-180 denotes the same meridian.
    if (
      (start[1] === end[1] &&
        (longitudeDifference === 0 || Math.abs(start[1]) === 90)) ||
      (start[1] === -end[1] &&
        (longitudeDifference === 180 || Math.abs(start[1]) === 90))
    )
      invalid();
    const corridorKm = params.has("corridorKm") ? tuple("corridorKm", 1)[0] : 1;
    if (corridorKm < 0.1 || corridorKm > 50) invalid();
    drawing = { mode: mode as ExploreDrawing["mode"], start, end, corridorKm };
  }
  return { viewport, drawing };
}

/** Commit spatial criteria through the same validation boundary used by shared URLs. */
export function withExploreSpatialFilters(
  filters: ExploreFilters,
  spatial: Pick<ExploreFilters, "viewport" | "drawing">,
): ExploreFilters {
  return parseExploreFilters(
    serializeExploreFilters({ ...filters, ...spatial, page: 1 }),
  );
}

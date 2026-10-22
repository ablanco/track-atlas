import type { ExploreFilters } from "./explore-types";
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
  return params;
}

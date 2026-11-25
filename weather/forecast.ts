import "server-only";
import { find } from "geo-tz";
import type { TrackMultiLineString } from "../tracks/geometry";

export type Condition =
  | "clear"
  | "cloudy"
  | "rain"
  | "snow"
  | "sleet"
  | "fog"
  | "thunder"
  | "unknown";
export type Forecast = {
  timeZone: string;
  updatedAt: string;
  periods: {
    time: string;
    temperature: number | null;
    wind: number | null;
    precipitation: number | null;
    periodHours: number | null;
    condition: Condition;
  }[];
};
type Dependencies = { fetch?: typeof fetch; now?: () => number };
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const hour = 3600000;
function condition(value: unknown): Condition {
  if (typeof value !== "string") return "unknown";
  if (value.includes("thunder")) return "thunder";
  if (value.includes("sleet")) return "sleet";
  if (value.includes("snow")) return "snow";
  if (value.includes("rain")) return "rain";
  if (value === "fog") return "fog";
  if (/^(clearsky|fair)(_(day|night|polartwilight))?$/.test(value))
    return "clear";
  if (/^(partlycloudy|cloudy)(_(day|night|polartwilight))?$/.test(value))
    return "cloudy";
  return "unknown";
}
function parse(value: unknown, now: number, timeZone: string): Forecast | null {
  const properties = object(object(value).properties);
  const meta = object(properties.meta);
  const updatedAt = typeof meta.updated_at === "string" ? meta.updated_at : "";
  const updated = Date.parse(updatedAt);
  if (
    !Number.isFinite(updated) ||
    updated < now - 24 * hour ||
    updated > now + hour ||
    !Array.isArray(properties.timeseries)
  )
    return null;
  const units = object(meta.units);
  const periods: Forecast["periods"] = [];
  for (const raw of properties.timeseries) {
    const item = object(raw);
    const time = typeof item.time === "string" ? Date.parse(item.time) : NaN;
    if (
      !Number.isFinite(time) ||
      time < now ||
      time >= now + 120 * hour ||
      time % (6 * hour) !== 0
    )
      continue;
    const data = object(item.data);
    const instant = object(object(data.instant).details);
    const periodHours = data.next_6_hours ? 6 : data.next_1_hours ? 1 : null;
    const period = object(
      periodHours === 6 ? data.next_6_hours : data.next_1_hours,
    );
    const wind = units.wind_speed === "m/s" ? finite(instant.wind_speed) : null;
    const rain =
      units.precipitation_amount === "mm"
        ? finite(object(period.details).precipitation_amount)
        : null;
    periods.push({
      time: new Date(time).toISOString(),
      temperature:
        units.air_temperature === "celsius"
          ? finite(instant.air_temperature)
          : null,
      wind: wind !== null && wind >= 0 ? wind * 3.6 : null,
      precipitation: rain !== null && rain >= 0 ? rain : null,
      periodHours,
      condition: condition(object(period.summary).symbol_code),
    });
  }
  const usable = periods.filter(
    (period) =>
      period.temperature !== null ||
      period.wind !== null ||
      period.precipitation !== null ||
      period.condition !== "unknown",
  );
  usable.sort((a, b) => a.time.localeCompare(b.time));
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dates = new Set<string>();
  const fiveDays = usable.filter((period) => {
    const date = localDate.format(new Date(period.time));
    if (!dates.has(date) && dates.size === 5) return false;
    dates.add(date);
    return true;
  });
  return usable.length
    ? {
        timeZone,
        updatedAt,
        periods: [
          ...new Map(fiveDays.map((period) => [period.time, period])).values(),
        ],
      }
    : null;
}

/** Server-only transport seam. The caller must authorize Track geometry first. */
export function createForecastService({
  fetch: transport = fetch,
  now = Date.now,
}: Dependencies = {}) {
  type Entry = {
    expires: number;
    value: unknown;
    modified?: string;
    pending?: Promise<void>;
  };
  const cache = new Map<string, Entry>();
  let nextRequest = 0;
  return async (geometry: TrackMultiLineString): Promise<Forecast | null> => {
    const point = geometry.coordinates[0]?.[0];
    if (!point) return null;
    const [longitude, latitude] = point;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    )
      return null;
    try {
      const timeZone = find(latitude, longitude)[0];
      if (!timeZone) return null;
      const truncate = (value: number) => Math.trunc(value * 10000) / 10000;
      const url = new URL(
        "https://api.met.no/weatherapi/locationforecast/2.0/compact",
      );
      url.searchParams.set("lat", String(truncate(latitude)));
      url.searchParams.set("lon", String(truncate(longitude)));
      const key = url.search;
      const timestamp = now();
      let entry = cache.get(key);
      if (entry?.pending) await entry.pending;
      if (entry && entry.expires > timestamp)
        return parse(entry.value, now(), timeZone);
      // Admission is synchronous, bounded and fail-closed; no unbounded queue.
      if (timestamp < nextRequest) return null;
      if (!entry && cache.size >= 512) {
        for (const [oldKey, old] of cache) {
          if (!old.pending && old.expires <= timestamp) {
            cache.delete(oldKey);
            break;
          }
        }
        if (cache.size >= 512) return null;
      }
      nextRequest = timestamp + 100; // at most ten requests/sec per process
      const previous = entry;
      entry = { expires: timestamp + 3 * hour, value: null };
      cache.set(key, entry);
      const current = entry;
      current.pending = (async () => {
        try {
          const headers: Record<string, string> = {
            "User-Agent": "TrackAtlas (https://github.com/ablanco/track-atlas)",
          };
          if (previous?.modified)
            headers["If-Modified-Since"] = previous.modified;
          const response = await transport(url, {
            headers,
            cache: "no-store",
            credentials: "omit",
            signal: AbortSignal.timeout(5000),
            redirect: "follow",
          });
          const expires = Date.parse(response.headers.get("expires") ?? "");
          if (Number.isFinite(expires))
            current.expires = Math.max(current.expires, expires);
          if (response.status === 304 && previous?.value) {
            current.value = previous.value;
            current.modified = previous.modified;
          } else if (response.ok) {
            current.value = await response.json();
            const modified = response.headers.get("last-modified");
            if (modified && Number.isFinite(Date.parse(modified)))
              current.modified = modified;
          } else if (response.status === 429 || response.status === 503) {
            const retry = response.headers.get("retry-after");
            const delay =
              retry && /^\d+$/.test(retry)
                ? Number(retry) * 1000
                : Date.parse(retry ?? "") - timestamp;
            nextRequest = Math.max(
              nextRequest,
              timestamp +
                (Number.isFinite(delay) ? Math.max(delay, 60000) : 60000),
            );
          }
        } catch {
          current.value = null;
        } finally {
          current.pending = undefined;
        }
      })();
      await current.pending;
      return parse(current.value, now(), timeZone);
    } catch {
      return null;
    }
  };
}
export const getForecast = createForecastService();

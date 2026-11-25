import "server-only";
import { getTrackData } from "../tracks/service";
import { getForecast } from "./forecast";

/** No identity or Track ID is ever admitted to the shared coordinate cache. */
export async function getTrackForecast(
  dependencies: Parameters<typeof getTrackData>[0],
  forecast = getForecast,
) {
  const data = await getTrackData(dependencies);
  return data ? forecast(data.geometry) : null;
}

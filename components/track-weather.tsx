import { unstable_rethrow } from "next/navigation";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { CloudIcon } from "@phosphor-icons/react/dist/ssr/Cloud";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";
import { CloudRainIcon } from "@phosphor-icons/react/dist/ssr/CloudRain";
import { CloudSnowIcon } from "@phosphor-icons/react/dist/ssr/CloudSnow";
import { CloudLightningIcon } from "@phosphor-icons/react/dist/ssr/CloudLightning";
import { CloudFogIcon } from "@phosphor-icons/react/dist/ssr/CloudFog";
import { getDb } from "@/db";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { getTrackForecast } from "@/weather/track";
import { WeatherDays } from "./weather-days";
import type { Forecast } from "@/weather/forecast";

const icons = {
  clear: SunIcon,
  cloudy: CloudIcon,
  rain: CloudRainIcon,
  snow: CloudSnowIcon,
  sleet: CloudSnowIcon,
  fog: CloudFogIcon,
  thunder: CloudLightningIcon,
  unknown: CloudIcon,
};
export async function TrackWeather({ id }: { id: string }) {
  const t = await getTranslations("Tracks.weather");
  const locale = await getLocale();
  let forecast: Forecast | null = null;
  try {
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    forecast = await getTrackForecast({ db: getDb(), token, id });
  } catch (error) {
    unstable_rethrow(error);
  }
  const date = forecast
    ? new Intl.DateTimeFormat(locale, {
        timeZone: forecast.timeZone,
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const groups = new Map<string, Forecast["periods"]>();
  const localDay = forecast
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: forecast.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    : null;
  for (const period of forecast?.periods ?? []) {
    const key = localDay!.format(new Date(period.time));
    const periods = groups.get(key) ?? [];
    periods.push(period);
    groups.set(key, periods);
  }
  const dayLabel = forecast
    ? new Intl.DateTimeFormat(locale, {
        timeZone: forecast.timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;
  const localHour = forecast
    ? new Intl.DateTimeFormat("en", {
        timeZone: forecast.timeZone,
        hour: "numeric",
        hourCycle: "h23",
      })
    : null;
  return (
    <section
      aria-label={t("title")}
      className="min-w-0 space-y-4 rounded-md border bg-muted/30 p-4"
    >
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      {forecast && date ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t("schedule")} {t("timezone", { zone: forecast.timeZone })}{" "}
            {t("updated", { time: date.format(new Date(forecast.updatedAt)) })}
          </p>
          <p className="text-sm text-muted-foreground">{t("selectDay")}</p>
          <WeatherDays
            days={Array.from(groups, ([key, periods]) => {
              const representative = periods.reduce((best, period) =>
                Math.abs(
                  Number(localHour!.format(new Date(period.time))) - 12,
                ) <
                Math.abs(Number(localHour!.format(new Date(best.time))) - 12)
                  ? period
                  : best,
              );
              const Icon = icons[representative.condition];
              const temperatures = periods.flatMap((period) =>
                period.temperature === null ? [] : [period.temperature],
              );
              const low = Math.min(...temperatures);
              const high = Math.max(...temperatures);
              const temperature =
                temperatures.length === 0
                  ? t("missing")
                  : low === high
                    ? `${number.format(low)} °C`
                    : `${number.format(low)}–${number.format(high)} °C`;
              return {
                key,
                summary: (
                  <>
                    <span>{dayLabel!.format(new Date(periods[0].time))}</span>
                    <Icon aria-hidden="true" className="size-6" />
                    <span className="sr-only">
                      {t(`conditions.${representative.condition}`)}
                    </span>
                    <span>{temperature}</span>
                  </>
                ),
                details: (
                  <ul className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {periods.map((period) => {
                      const Icon = icons[period.condition];
                      const value = (v: number | null, unit: string) =>
                        v === null
                          ? t("missing")
                          : `${number.format(v)} ${unit}`;
                      return (
                        <li
                          key={period.time}
                          className="min-w-0 space-y-2 rounded-md border bg-background p-3 text-sm"
                        >
                          <time dateTime={period.time} className="font-medium">
                            {date.format(new Date(period.time))}
                          </time>
                          <p className="flex items-center gap-2">
                            <Icon
                              aria-hidden="true"
                              className="size-5 shrink-0"
                            />
                            {t(`conditions.${period.condition}`)}
                          </p>
                          <dl className="space-y-1">
                            <div>
                              <dt className="inline text-muted-foreground">
                                {t("temperature")}:{" "}
                              </dt>
                              <dd className="inline">
                                {value(period.temperature, "°C")}
                              </dd>
                            </div>
                            <div>
                              <dt className="inline text-muted-foreground">
                                {t("wind")}:{" "}
                              </dt>
                              <dd className="inline">
                                {value(period.wind, "km/h")}
                              </dd>
                            </div>
                            <div>
                              <dt className="inline text-muted-foreground">
                                {t("precipitation")}:{" "}
                              </dt>
                              <dd className="inline">
                                {period.precipitation === null
                                  ? t("missing")
                                  : t("rainPeriod", {
                                      amount: number.format(
                                        period.precipitation,
                                      ),
                                      hours: period.periodHours!,
                                    })}
                              </dd>
                            </div>
                          </dl>
                        </li>
                      );
                    })}
                  </ul>
                ),
              };
            })}
          />
        </>
      ) : (
        <p role="status">{t("unavailable")}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {t("source")}{" "}
        <a href="https://www.met.no/" className="underline">
          MET Norway
        </a>{" "}
        ·{" "}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          className="underline"
        >
          CC BY 4.0
        </a>
      </p>
      <p className="text-xs text-muted-foreground">
        {t("timezoneSource")}{" "}
        <a
          href="https://github.com/evansiroky/timezone-boundary-builder"
          className="underline"
        >
          timezone-boundary-builder
        </a>
        {" · "}
        <a href="https://www.openstreetmap.org/copyright" className="underline">
          © OpenStreetMap contributors
        </a>
        {" · "}
        <a
          href="https://opendatacommons.org/licenses/odbl/1-0/"
          className="underline"
        >
          ODbL
        </a>
      </p>
    </section>
  );
}

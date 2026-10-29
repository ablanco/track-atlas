import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { getTrackSamples } from "@/tracks/service";
import { prepareTrackCharts } from "@/tracks/chart-data";
import { TrackCharts } from "@/components/track-charts";

/** Independent streamed visualization: never blocks details or the download. */
export async function AnalyticsCharts({
  id,
  elevationNotice,
}: {
  id: string;
  elevationNotice: string | null;
}) {
  const t = await getTranslations("Tracks.analytics");
  const locale = await getLocale();
  let series;
  try {
    const samples = await getTrackSamples({
      db: getDb(),
      token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
      id,
    });
    series = samples ? prepareTrackCharts(samples) : null;
  } catch {
    series = null;
  }
  if (!series)
    return (
      <div role="status" className="space-y-2 text-sm text-muted-foreground">
        <p>{t("chartFailure")}</p>
        <a className="inline-block min-h-11 py-3 underline" href="">
          {t("chartRetry")}
        </a>
      </div>
    );

  const common = {
    distanceAxis: t("distanceAxis"),
    distanceUnit: "km",
    downsampledNotice: t("downsampled"),
    previous: t("previousSection"),
    next: t("nextSection"),
    sectionLabel: t("sectionLabel"),
    missingValue: t("missingValue"),
    sectionUnavailable: t("sectionUnavailable"),
    helpLabel: t("help"),
  };
  const charts = [
    {
      ...common,
      key: "elevation",
      notice: elevationNotice,
      help: [t("rangeHint"), t("elevationHint"), t("keyboardHint")],
      name: t("elevationChart"),
      unavailable: t("elevationChartUnavailable"),
      valueAxis: t("elevationAxis"),
      unit: "m",
      color: "var(--chart-elevation)",
      ...series.elevation,
    },
    {
      ...common,
      key: "speed",
      notice: null,
      help: [t("speedHint"), t("keyboardHint")],
      name: t("speedChart"),
      unavailable: t("speedChartUnavailable"),
      valueAxis: t("speedAxis"),
      unit: "km/h",
      color: "var(--chart-speed)",
      ...series.speed,
    },
  ];
  return (
    <TrackCharts
      charts={charts}
      locale={locale}
      loading={t("loadingCharts")}
      failure={t("chartFailure")}
      retry={t("chartRetry")}
    />
  );
}

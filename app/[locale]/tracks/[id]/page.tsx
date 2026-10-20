import { Suspense } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { getDb } from "@/db";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { getTrack } from "@/tracks/service";
import { AnalyticsCharts } from "./analytics-charts";
import {
  formatTrackDistance,
  formatTrackElevation,
  formatRecordedDuration,
} from "@/tracks/format";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Tracks");
  return {
    title: `${t("detailsTitle")} — Track Atlas`,
    robots: { index: false, follow: false },
  };
}
async function PrivateDetails({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const t = await getTranslations("Tracks");
  const locale = await getLocale();
  let track;
  try {
    track = await getTrack({
      db: getDb(),
      token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
      id,
    });
  } catch {
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive p-4 text-destructive"
      >
        {t("detailsUnavailable")}
      </p>
    );
  }
  if (!track) notFound();
  const entries = [
    [t("activity"), t(`activities.${track.activity}`)],
    [t("difficulty"), `${track.difficulty} / 5`],
    [t("visibility"), t("private")],
    [t("owner"), track.ownerName],
    [
      t("uploaded"),
      new Intl.DateTimeFormat(locale, {
        dateStyle: "long",
        timeZone: "UTC",
      }).format(track.createdAt),
    ],
    [t("distance"), formatTrackDistance(track.distanceMeters, locale)],
    [t("points"), new Intl.NumberFormat(locale).format(track.pointCount)],
  ];
  const elevation = (value: number | null) =>
    value === null
      ? t("analytics.unavailable")
      : formatTrackElevation(value, locale);
  const metrics = [
    [t("analytics.ascent"), elevation(track.ascentMeters)],
    [t("analytics.descent"), elevation(track.descentMeters)],
    [t("analytics.minimum"), elevation(track.minElevationMeters)],
    [t("analytics.maximum"), elevation(track.maxElevationMeters)],
    [
      t("analytics.duration"),
      track.durationSeconds === null
        ? t("analytics.unavailable")
        : formatRecordedDuration(track.durationSeconds, locale),
    ],
  ];
  return (
    <article className="space-y-7">
      <h1 className="break-words text-3xl font-semibold tracking-tight">
        {track.name}
      </h1>
      <p className="break-words whitespace-pre-wrap">{track.description}</p>
      <dl className="grid gap-5 sm:grid-cols-2">
        {entries.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-words font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="analytics-heading" className="space-y-4">
        <h2 id="analytics-heading" className="text-xl font-semibold">
          {t("analytics.title")}
        </h2>
        <dl className="grid gap-5 sm:grid-cols-2">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">
          {track.elevationSampleCount === 0
            ? t("analytics.noElevation")
            : track.elevationSampleCount < track.pointCount
              ? t("analytics.partialElevation", {
                  count: track.elevationSampleCount,
                  total: track.pointCount,
                })
              : t("analytics.completeElevation")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("analytics.elevationHint")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("analytics.durationHint")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("analytics.speedHint")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("analytics.keyboardHint")}
        </p>
        <Suspense
          fallback={<p role="status">{t("analytics.loadingCharts")}</p>}
        >
          <AnalyticsCharts id={id} />
        </Suspense>
      </section>
      <section aria-label={t("tags")}>
        <h2 className="text-sm text-muted-foreground">{t("tags")}</h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {track.tags.map((tag) => (
            <li
              className="max-w-full rounded-md bg-muted px-3 py-2 text-sm break-words"
              key={tag}
            >
              {tag}
            </li>
          ))}
        </ul>
      </section>
      <p className="text-sm text-muted-foreground">{t("difficultyHint")}</p>
      <p className="text-sm text-muted-foreground">{t("privateHint")}</p>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          render={<a href={`/api/tracks/${track.id}/download`} />}
          nativeButton={false}
          role="link"
          className="min-h-11"
        >
          <DownloadSimpleIcon aria-hidden="true" />
          {t("download")}
        </Button>
        <Link
          href="/tracks/upload"
          className="py-3 text-sm underline underline-offset-4"
        >
          {t("back")}
        </Link>
      </div>
    </article>
  );
}
export default async function DetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getTranslations("Tracks");
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-2xl flex-1 px-5 py-12 sm:px-8 sm:py-16"
    >
      <Suspense fallback={<p role="status">{t("loading")}</p>}>
        <PrivateDetails params={params} />
      </Suspense>
    </main>
  );
}

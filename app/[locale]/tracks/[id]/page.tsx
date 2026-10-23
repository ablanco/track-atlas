import { Suspense } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { getDb } from "@/db";
import { getCurrentUser, SESSION_COOKIE_NAME } from "@/auth/session";
import { getTrack } from "@/tracks/service";
import { AnalyticsCharts } from "./analytics-charts";
import { TrackMap } from "@/components/track-map";
import { ActivityIcon } from "@/components/activity-icon";
import { ExploreEntryHint } from "@/components/explore-entry-hint";
import {
  formatTrackDistance,
  formatTrackElevation,
  formatRecordedDuration,
} from "@/tracks/format";
import { Link } from "@/i18n/navigation";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AuthControl } from "@/components/auth-control";
import { getAuthLabels } from "@/components/auth-labels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Tracks");
  return {
    title: `${t("detailsTitle")} — Track Atlas`,
    robots: { index: false, follow: false },
  };
}
async function TrackDetails({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const t = await getTranslations("Tracks");
  const locale = await getLocale();
  let track;
  let user;
  try {
    user = await getCurrentUser();
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
  const descriptionHeading = `track-${track.id}-${locale}-description`;
  const metadataHeading = `track-${track.id}-${locale}-metadata`;
  const elevation = (value: number | null) =>
    value === null
      ? t("analytics.unavailable")
      : formatTrackElevation(value, locale);
  const partialElevation =
    track.elevationSampleCount > 0 &&
    track.elevationSampleCount < track.pointCount;
  const elevationNotice =
    track.elevationSampleCount === 0
      ? t("analytics.noElevation")
      : partialElevation
        ? t("analytics.partialElevation", {
            count: track.elevationSampleCount,
            total: track.pointCount,
          })
        : null;
  const range =
    track.minElevationMeters === null || track.maxElevationMeters === null
      ? null
      : track.maxElevationMeters - track.minElevationMeters;
  const stats = [
    [t("length"), formatTrackDistance(track.distanceMeters, locale)],
    [t("difficulty"), `${track.difficulty} / 5`],
    [t("analytics.range"), elevation(range)],
    [t("analytics.ascent"), elevation(track.ascentMeters)],
    [t("analytics.descent"), elevation(track.descentMeters)],
  ];
  const entries = [
    [t("activity"), t(`activities.${track.activity}`)],
    [t("visibility"), t(track.visibility)],
    [
      t("uploaded"),
      new Intl.DateTimeFormat(locale, {
        dateStyle: "long",
        timeZone: "UTC",
      }).format(track.createdAt),
    ],
    [t("points"), new Intl.NumberFormat(locale).format(track.pointCount)],
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
    <article className="min-w-0 space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
          <ExploreEntryHint label={t(`activities.${track.activity}`)} size="lg">
            <ActivityIcon activity={track.activity} size="lg" />
          </ExploreEntryHint>
          <h1 className="min-w-0 flex-1 break-words text-3xl font-semibold tracking-tight">
            {track.name}
          </h1>
        </div>
        {user ? (
          <Button
            render={<a href={`/api/tracks/${track.id}/download`} />}
            nativeButton={false}
            role="link"
            className="min-h-11 shrink-0"
          >
            <DownloadSimpleIcon aria-hidden="true" />
            {t("download")}
          </Button>
        ) : (
          <AuthControl
            status="guest"
            userName=""
            locale={locale}
            labels={{ ...(await getAuthLabels()), login: t("loginToDownload") }}
          />
        )}
      </header>
      <section aria-label={t("analytics.title")} className="min-w-0 space-y-8">
        <dl
          aria-label={t("mainStats")}
          className="grid grid-cols-2 gap-5 rounded-md border bg-muted/30 p-5 sm:grid-cols-3 lg:grid-cols-5"
        >
          {stats.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 break-words text-lg font-semibold tabular-nums">
                {value}
                {partialElevation && label === t("analytics.range") && (
                  <span className="mt-1 block text-sm font-normal text-muted-foreground">
                    {t("analytics.partialData")}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <TrackMap id={track.id} />
        <Suspense
          fallback={<p role="status">{t("analytics.loadingCharts")}</p>}
        >
          <AnalyticsCharts id={id} elevationNotice={elevationNotice} />
        </Suspense>
      </section>
      <section
        aria-labelledby={descriptionHeading}
        className="max-w-prose space-y-3"
      >
        <h2 id={descriptionHeading} className="text-xl font-semibold">
          {t("description")}
        </h2>
        <p className="break-words whitespace-pre-wrap">{track.description}</p>
      </section>
      {track.tags.length > 0 && (
        <section aria-label={t("tags")} className="space-y-3">
          <h2 className="text-xl font-semibold">{t("tags")}</h2>
          <ul className="flex flex-wrap gap-2">
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
      )}
      <section
        aria-labelledby={metadataHeading}
        className="space-y-5 border-t pt-6"
      >
        <h2 id={metadataHeading} className="text-xl font-semibold">
          {t("metadata")}
        </h2>
        <section aria-label={t("owner")} className="flex items-center gap-5">
          <Avatar className="size-32" aria-hidden="true">
            <AvatarImage
              src={`/api/tracks/${track.id}/avatar`}
              alt=""
              width={128}
              height={128}
            />
            <AvatarFallback className="text-3xl">
              {track.ownerName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => Array.from(part)[0])
                .join("")
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h3 className="text-sm text-muted-foreground">{t("owner")}</h3>
            <p className="text-2xl break-words font-medium">
              {track.ownerName}
            </p>
          </div>
        </section>
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <details className="max-w-prose text-sm text-muted-foreground">
          <summary className="min-h-11 cursor-pointer rounded-md py-3 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
            {t("metadataHelp")}
          </summary>
          <div className="space-y-2 pb-3">
            <p>{t("difficultyHint")}</p>
            <p>{t("analytics.durationHint")}</p>
            <p>
              {t(track.visibility === "public" ? "publicHint" : "privateHint")}
            </p>
          </div>
        </details>
      </section>
      <Link
        href="/tracks/upload"
        className="inline-block py-3 text-sm underline underline-offset-4"
      >
        {t("back")}
      </Link>
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
      className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8 sm:py-16"
    >
      <Suspense fallback={<p role="status">{t("loading")}</p>}>
        <TrackDetails params={params} />
      </Suspense>
    </main>
  );
}

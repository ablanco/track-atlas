import { unstable_rethrow } from "next/navigation";
import { readPublicTrack, TrackStructuredData } from "@/seo/track";
import { publicMetadata, excerpt } from "@/seo/metadata";
import { appOrigin, noIndex } from "@/seo/config";
import { trackPreview } from "@/tracks/public";
import { TrackComments } from "@/components/track-comments";
import { randomUUID } from "node:crypto";
import {
  TrackVoting,
  TrackVotingProvider,
  TrackPopularity,
} from "@/components/track-voting";
import { getTrackVotes } from "@/tracks/votes";
import { BookmarkPicker } from "@/components/bookmark-picker";
import { cache, Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PencilLineIcon } from "@phosphor-icons/react/dist/ssr/PencilLine";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { getDb } from "@/db";
import { getCurrentUser, SESSION_COOKIE_NAME } from "@/auth/session";
import { getTrack } from "@/tracks/service";
import { AnalyticsCharts } from "./analytics-charts";
import { TrackMap } from "@/components/track-map";
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
import {
  TrackEditor,
  TrackShare,
  TrackEditControls,
  TrackEditField,
  TrackActivity,
  TrackTagsSection,
  TrackPhotosSection,
} from "./track-editor";

// React memoization shares the same request-specific result (including failures)
// between metadata and content, without caching sessions across requests.
const readTrackDetails = cache(async (id: string) => {
  await connection();
  const user = await getCurrentUser();
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const track = await getTrack({ db: getDb(), token, id });
  const votes = track ? await getTrackVotes({ db: getDb(), token, id }) : null;
  return { user, track, votes };
});

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { id, locale } = await params;
  const t = await getTranslations("Tracks");
  try {
    const track = await readPublicTrack(id);
    const details = track ? await readTrackDetails(id) : null;
    if (track && details?.track && details.votes)
      return publicMetadata({
        locale,
        path: `/tracks/${track.id}`,
        title: `${track.name} — Track Atlas`,
        description: excerpt(track.description),
        image: trackPreview(track),
        duplicate: Object.keys(await searchParams).length > 0,
      });
  } catch (error) {
    unstable_rethrow(error); /* Fail closed on application errors. */
  }
  return { title: `${t("detailsTitle")} — Track Atlas`, robots: noIndex };
}
async function TrackDetails({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const t = await getTranslations("Tracks");
  const locale = await getLocale();
  let track;
  let user;
  let votes;
  try {
    ({ user, track, votes } = await readTrackDetails(id));
  } catch (error) {
    unstable_rethrow(error);
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive p-4 text-destructive"
      >
        {t("detailsUnavailable")}
      </p>
    );
  }
  if (!track || !votes) notFound();
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
  const stats: [string, ReactNode][] = [
    [t("votes.popularity"), <TrackPopularity key="popularity" />],
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
    [t("segments"), new Intl.NumberFormat(locale).format(track.segmentCount)],
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
    <TrackEditor
      key={`${track.id}:${user?.userId ?? "guest"}`}
      id={track.id}
      canEdit={track.canEdit}
      initialPhotos={track.photos}
      initial={{
        name: track.name,
        description: track.description,
        activity: track.activity,
        difficulty: track.difficulty,
        tags: track.tags,
        visibility: track.visibility,
      }}
      collectionHref={user ? `/users/${user.userId}/tracks` : "/explore"}
    >
      <TrackVotingProvider key={randomUUID()} id={track.id} initial={votes}>
        <article className="min-w-0 space-y-8">
          <TrackStructuredData id={id} locale={locale} />
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
              <TrackActivity />
              <h1 className="min-w-0 break-words text-3xl font-semibold tracking-tight">
                <TrackEditField field="name" />
              </h1>
            </div>
          </header>
          <section
            aria-label={t("analytics.title")}
            className="min-w-0 space-y-8"
          >
            <dl
              aria-label={t("mainStats")}
              className="grid grid-cols-2 gap-5 rounded-md border bg-muted/30 p-5 sm:grid-cols-3 lg:grid-cols-6"
            >
              {stats.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words text-lg font-semibold tabular-nums">
                    {label === t("difficulty") ? (
                      <TrackEditField field="difficulty" />
                    ) : (
                      value
                    )}
                    {partialElevation && label === t("analytics.range") && (
                      <span className="mt-1 block text-sm font-normal text-muted-foreground">
                        {t("analytics.partialData")}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <TrackMap id={track.id}>
              <aside
                aria-label={t("tools")}
                className="min-w-0 space-y-3 rounded-md border bg-muted/30 p-3 [&_button]:h-auto [&_button]:min-h-11 [&_button]:max-w-full [&_button]:py-2 [&_button]:whitespace-normal [&_button[aria-haspopup=dialog]]:w-full [&_a[download]]:max-w-full [&_a[download]]:whitespace-normal"
              >
                <h2 className="text-lg font-semibold">{t("tools")}</h2>
                <TrackEditControls />
                {user ? (
                  <Button
                    render={
                      <a href={`/api/tracks/${track.id}/download`} download />
                    }
                    nativeButton={false}
                    role="link"
                    className="min-h-11 w-full justify-start text-left"
                  >
                    <DownloadSimpleIcon aria-hidden="true" />
                    {t("download")}
                  </Button>
                ) : (
                  <AuthControl
                    status="guest"
                    userName=""
                    locale={locale}
                    labels={{
                      ...(await getAuthLabels()),
                      login: t("loginToDownload"),
                    }}
                  />
                )}
                {user ? (
                  <Button
                    render={
                      <a
                        href={`/api/tracks/${track.id}/gpx-studio?locale=${locale}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    }
                    nativeButton={false}
                    role="link"
                    variant="outline"
                    className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left"
                  >
                    <PencilLineIcon aria-hidden="true" />
                    {t("gpxStudio")}
                  </Button>
                ) : (
                  <AuthControl
                    status="guest"
                    userName=""
                    locale={locale}
                    labels={{
                      ...(await getAuthLabels()),
                      login: t("loginToGpxStudio"),
                    }}
                  />
                )}
                <TrackShare
                  url={`${appOrigin()}/${locale}/tracks/${track.id}`}
                />
                <TrackVoting />
                <BookmarkPicker
                  key={randomUUID()}
                  trackId={track.id}
                  size="toolbox"
                  loadInitial={!!user}
                  authLabels={await getAuthLabels()}
                />
              </aside>
            </TrackMap>
            <TrackPhotosSection />
            {/* Keep login-modal isolation markers off deferred chart roots. */}
            <div className="contents">
              <Suspense
                fallback={<p role="status">{t("analytics.loadingCharts")}</p>}
              >
                <AnalyticsCharts id={id} elevationNotice={elevationNotice} />
              </Suspense>
            </div>
          </section>
          <section
            aria-labelledby={descriptionHeading}
            className="max-w-prose space-y-3"
          >
            <h2 id={descriptionHeading} className="text-xl font-semibold">
              {t("description")}
            </h2>
            <div className="break-words whitespace-pre-wrap">
              <TrackEditField field="description" />
            </div>
          </section>
          <TrackTagsSection />
          <section
            aria-labelledby={metadataHeading}
            className="space-y-5 border-t pt-6"
          >
            <h2 id={metadataHeading} className="text-xl font-semibold">
              {t("metadata")}
            </h2>
            <section
              aria-label={t("owner")}
              className="flex items-center gap-5"
            >
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
                  <dd className="mt-1 break-words font-medium">
                    {label === t("activity") ? (
                      <TrackEditField field="activity" />
                    ) : label === t("visibility") ? (
                      <TrackEditField field="visibility" />
                    ) : (
                      value
                    )}
                  </dd>
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
                  {t(
                    track.visibility === "public"
                      ? "publicHint"
                      : "privateHint",
                  )}
                </p>
              </div>
            </details>
          </section>
          <TrackComments
            key={randomUUID()}
            id={track.id}
            authLabels={await getAuthLabels()}
          />
          <Link
            href="/tracks/upload"
            className="inline-block py-3 text-sm underline underline-offset-4"
          >
            {t("back")}
          </Link>
        </article>
      </TrackVotingProvider>
    </TrackEditor>
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

import { connection } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { getDb } from "@/db";
import { getTrackUploadResult } from "@/tracks/service";
import { Link } from "@/i18n/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ExplorePageContent } from "@/components/explore-page";

export async function generateMetadata() {
  const t = await getTranslations("Explore");
  return {
    title: `${t("collection")} — Track Atlas`,
    robots: { index: false, follow: false },
  };
}
type CollectionProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string | string[] }>;
};
async function UploadConfirmation({ params, searchParams }: CollectionProps) {
  await connection();
  const requestId = (await searchParams).created;
  if (typeof requestId !== "string") return null;
  const result = await getTrackUploadResult({
    db: getDb(),
    token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
    requestId,
  });
  if (
    !result ||
    result.ownerId !== (await params).id ||
    result.tracks.length < 2
  )
    return null;
  const t = await getTranslations("Tracks");
  return (
    <section
      aria-label={t("created.title")}
      className="mx-auto w-full max-w-6xl space-y-3 px-5 py-6 sm:px-8"
    >
      <h2 className="text-xl font-semibold" role="status">
        {t("created.count", { count: result.tracks.length })}
      </h2>
      <ol
        className="max-h-64 list-decimal space-y-2 overflow-auto break-words pl-6"
        tabIndex={0}
        aria-label={t("preview.titles")}
      >
        {result.tracks.map((track) => (
          <li key={track.id}>
            <Link
              href={`/tracks/${track.id}`}
              className="inline-flex min-h-11 items-center underline underline-offset-4"
            >
              {track.name}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
export default async function CollectionPage({
  params,
  searchParams,
}: CollectionProps) {
  const t = await getTranslations("Explore");
  return (
    <>
      <span hidden data-explorer-page />
      <Suspense fallback={null}>
        <UploadConfirmation params={params} searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<p role="status">{t("loading")}</p>}>
        <ExplorePageContent params={params} />
      </Suspense>
    </>
  );
}

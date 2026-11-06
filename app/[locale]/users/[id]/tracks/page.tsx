import { connection } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { getDb } from "@/db";
import { getTrackUploadResult } from "@/tracks/service";
import { TrackUploadToast } from "@/components/track-upload-toast";
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
    <TrackUploadToast
      requestId={requestId}
      message={t("created.count", { count: result.tracks.length })}
    />
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

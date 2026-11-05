import { unstable_rethrow } from "next/navigation";
import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { getDb } from "@/db";
import { getPublicTrack, trackPreview } from "@/tracks/public";
import { StructuredData, excerpt } from "./metadata";

// React cache is request-scoped, never a cross-request authorization cache.
export const readPublicTrack = cache(async (id: string) => {
  await connection();
  return getPublicTrack(getDb(), id);
});
export async function TrackStructuredData({
  id,
  locale,
}: {
  id: string;
  locale: string;
}) {
  let track;
  try {
    track = await readPublicTrack(id);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
  if (!track) return null;
  return (
    <StructuredData
      type="WebPage"
      locale={locale}
      path={`/tracks/${track.id}`}
      name={track.name}
      description={excerpt(track.description)}
      image={trackPreview(track)}
    />
  );
}

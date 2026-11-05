import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getDb } from "@/db";
import { listPublicTracks } from "@/tracks/public";
import { appOrigin, indexingEnabled } from "@/seo/config";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  if (!indexingEnabled()) return [];
  const origin = appOrigin();
  // Request-time authority: withdrawal and edits never wait on a shared cache.
  // Let database failures return an error, never a partially authoritative list.
  const tracks = await listPublicTracks(getDb());
  return ["", ...tracks.map((track) => `/tracks/${track.id}`)].flatMap((path) =>
    ["en", "es"].map((locale) => ({
      url: `${origin}/${locale}${path}`,
      alternates: {
        languages: { en: `${origin}/en${path}`, es: `${origin}/es${path}` },
      },
    })),
  );
}

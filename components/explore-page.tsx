import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getCurrentUser, SESSION_COOKIE_NAME } from "@/auth/session";
import { getDb } from "@/db";
import { getExploreResults } from "@/tracks/explore";
import { parseExploreFilters } from "@/tracks/explore-query";
import { trackIdPattern } from "@/tracks/validation";
import { getAuthLabels } from "./auth-labels";
import { TrackExplorer } from "./track-explorer";

/** Session-dependent route output stays behind the page's Suspense boundary. */
export async function ExplorePageContent({
  params,
}: {
  params?: Promise<{ id: string }>;
}) {
  await connection();
  const ownerId = params ? (await params).id : undefined;
  if (ownerId !== undefined && !trackIdPattern.test(ownerId)) notFound();
  let identity = "guest";
  try {
    identity = (await getCurrentUser())?.userId ?? "guest";
  } catch {
    // The HTTP request renders its own unavailable/retry state.
    identity = "unavailable";
  }
  if (ownerId) {
    let exists = true;
    try {
      exists =
        (await getExploreResults({
          db: getDb(),
          token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
          ownerId,
          filters: parseExploreFilters(new URLSearchParams()),
        })) !== null;
    } catch {
      // Do not turn a temporary service failure into a missing collection.
    }
    if (!exists) notFound();
  }
  // A login/logout refresh remounts the client and discards private snapshots.
  return (
    <TrackExplorer
      key={`${ownerId ?? "public"}:${identity}:${randomUUID()}`}
      ownerId={ownerId}
      authLabels={await getAuthLabels()}
    />
  );
}

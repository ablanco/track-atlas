import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser, SESSION_COOKIE_NAME } from "@/auth/session";
import { getDb } from "@/db";
import { getTrackList } from "@/tracks/lists";
import { trackIdPattern } from "@/tracks/validation";
import { getAuthLabels } from "@/components/auth-labels";
import { TrackExplorer } from "@/components/track-explorer";
import { ListSessionPrompt } from "@/components/list-session-prompt";

export async function generateMetadata() {
  const t = await getTranslations("Lists");
  return {
    title: `${t("title")} — Track Atlas`,
    robots: { index: false, follow: false },
  };
}
async function Content({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const labels = await getAuthLabels();
  const t = await getTranslations("Lists");
  const { id } = await params;
  const prompt = (
    <main id="main-content" tabIndex={-1} className="flex-1 p-6">
      <ListSessionPrompt labels={labels} />
    </main>
  );
  let user;
  let list;
  try {
    user = await getCurrentUser();
    if (user && trackIdPattern.test(id))
      list = await getTrackList({
        db: getDb(),
        token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
        id,
      });
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "unauthorized"
    )
      return prompt;
    return (
      <main id="main-content" tabIndex={-1} className="p-6">
        <p role="alert">{t("errors.unavailable")}</p>
      </main>
    );
  }
  if (!user) return prompt;
  if (!list) notFound();
  return (
    <TrackExplorer
      key={`${id}:${user.userId}:${randomUUID()}`}
      listId={id}
      authLabels={labels}
    />
  );
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getTranslations("Lists");
  return (
    <Suspense fallback={<p role="status">{t("loading")}</p>}>
      <Content params={params} />
    </Suspense>
  );
}

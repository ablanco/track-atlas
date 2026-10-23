import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/auth/session";
import { getAuthLabels } from "@/components/auth-labels";
import { AuthControl } from "@/components/auth-control";
import { ListsOverview } from "@/components/lists-overview";
import { ListSessionPrompt } from "@/components/list-session-prompt";
export async function generateMetadata() {
  const t = await getTranslations("Lists");
  return {
    title: `${t("title")} — Track Atlas`,
    robots: { index: false, follow: false },
  };
}
async function Content() {
  await connection();
  const labels = await getAuthLabels();
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return (
      <AuthControl
        status="unavailable"
        userName=""
        locale={await getLocale()}
        labels={labels}
      />
    );
  }
  return user ? (
    <ListsOverview key={`${user.userId}:${randomUUID()}`} labels={labels} />
  ) : (
    <ListSessionPrompt labels={labels} />
  );
}
export default async function Page() {
  const t = await getTranslations("Lists");
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-5 py-12"
    >
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <Suspense fallback={<p role="status">{t("loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

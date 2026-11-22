import { Suspense } from "react";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/auth/session";
import { redirect } from "@/i18n/navigation";
import { FollowingOverview } from "@/components/following-overview";
export async function generateMetadata() {
  const t = await getTranslations("Following");
  return {
    title: `${t("title")} — Track Atlas`,
    robots: { index: false, follow: false },
  };
}
async function Content() {
  await connection();
  const locale = await getLocale();
  const t = await getTranslations("Following");
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return (
      <p role="alert" className="text-destructive">
        {t("unavailable")}
      </p>
    );
  }
  if (!user) return redirect({ href: "/", locale });
  return <FollowingOverview key={user.userId} />;
}
export default async function Page() {
  const t = await getTranslations("Following");
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

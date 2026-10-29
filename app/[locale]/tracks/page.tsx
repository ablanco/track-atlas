import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ExplorePageContent } from "@/components/explore-page";

export async function generateMetadata() {
  const t = await getTranslations("Explore");
  return {
    title: `${t("title")} — Track Atlas`,
    robots: { index: false, follow: false },
  };
}
export default async function ExplorePage() {
  const t = await getTranslations("Explore");
  return (
    <>
      <span hidden data-explorer-page />
      <Suspense fallback={<p role="status">{t("loading")}</p>}>
        <ExplorePageContent />
      </Suspense>
    </>
  );
}

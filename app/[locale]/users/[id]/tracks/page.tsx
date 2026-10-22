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
export default async function CollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getTranslations("Explore");
  return (
    <Suspense fallback={<p role="status">{t("loading")}</p>}>
      <ExplorePageContent params={params} />
    </Suspense>
  );
}

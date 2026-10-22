import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function CollectionNotFound() {
  const t = await getTranslations("Explore");
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-content flex-1 space-y-4 px-5 py-12"
    >
      <h1 className="text-2xl font-semibold">{t("notFound")}</h1>
      <Link href="/tracks" className="inline-block min-h-11 underline">
        {t("title")}
      </Link>
    </main>
  );
}

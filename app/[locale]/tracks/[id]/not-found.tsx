import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function TrackNotFound() {
  const t = await getTranslations("Tracks");
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-2xl flex-1 px-5 py-12 sm:px-8"
    >
      <h1 className="text-3xl font-semibold">{t("notFound")}</h1>
      <p className="mt-4">{t("notFoundHint")}</p>
      <Link
        href="/tracks/upload"
        className="mt-5 inline-block py-3 underline underline-offset-4"
      >
        {t("title")}
      </Link>
    </main>
  );
}

import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("Legal");
  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-6 py-10">
      <p role="status">{t("loading")}</p>
    </main>
  );
}

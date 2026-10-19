import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AccountLinkState } from "@/components/account-link-state";
export async function generateMetadata() {
  const t = await getTranslations("AccountEmails.ui");
  return {
    title: `${t("resetTitle")} — Track Atlas`,
    robots: { index: false, follow: false },
    referrer: "no-referrer" as const,
  };
}
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("AccountEmails.ui");
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-xl flex-1 px-5 py-12 sm:px-8"
    >
      <Suspense fallback={<p role="status">{t("loading")}</p>}>
        <AccountLinkState kind="password-reset" searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

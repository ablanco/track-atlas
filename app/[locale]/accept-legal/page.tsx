import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { SESSION_COOKIE_NAME } from "@/auth/session";
import { findSessionIdentity, findSessionUser } from "@/auth/session-store";
import { legalDocuments } from "@/legal/documents";
import { safeLegalDestination } from "@/legal/destination";
import { AcceptanceForm } from "./acceptance-form";
export async function generateMetadata() {
  const t = await getTranslations("LegalRenewal");
  return {
    title: `${t("title")} — Track Atlas`,
    robots: { index: false, follow: false },
  };
}
async function Renewal({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const locale = await getLocale();
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!(await findSessionIdentity(getDb(), token))) redirect(`/${locale}`);
  const destination = safeLegalDestination(
    (await searchParams).returnTo,
    locale,
  );
  if (await findSessionUser(getDb(), token)) redirect(destination);
  const t = await getTranslations("LegalRenewal");
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-2xl flex-1 px-5 py-12"
    >
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-4">{t("description")}</p>
      <AcceptanceForm
        locale={locale}
        returnTo={destination}
        versions={{
          termsVersion: legalDocuments.terms.currentVersion,
          privacyVersion: legalDocuments.privacy.currentVersion,
        }}
      />
    </main>
  );
}
export default function AcceptancePage(props: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  return (
    <Suspense>
      <Renewal {...props} />
    </Suspense>
  );
}

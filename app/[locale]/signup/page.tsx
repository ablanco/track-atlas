import { Suspense } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/auth/session";
import { Link } from "@/i18n/navigation";
import { hasUploadIntent } from "@/auth/upload-intent";
import { redirect } from "@/i18n/navigation";
import { SignupForm, type SignupLabels } from "./signup-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Signup");
  return {
    title: `${t("title")} — Track Atlas`,
    description: t("description"),
    alternates: { languages: { en: "/en/signup", es: "/es/signup" } },
  };
}

type SignupQuery = Promise<Record<string, string | string[] | undefined>>;
async function GuestForm({ searchParams }: { searchParams: SignupQuery }) {
  // Auth and today's birthday limit must be evaluated for the actual request,
  // not a development prerender or a prefetched guest-form snapshot.
  await connection();
  const t = await getTranslations("Signup");
  const locale = await getLocale();
  const uploadIntent = hasUploadIntent((await searchParams).intent);
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return (
      <Alert variant="destructive" className="mt-7">
        <AlertDescription>{t("unavailable")}</AlertDescription>
      </Alert>
    );
  }
  if (user && uploadIntent) redirect({ href: "/tracks/upload", locale });
  if (user)
    return (
      <div className="mt-7 space-y-4">
        <p role="status">{t("alreadySignedIn")}</p>
        <Link
          href="/"
          className="font-semibold text-foreground underline underline-offset-4"
        >
          {t("goHome")}
        </Link>
      </div>
    );
  const labels: SignupLabels = {
    fields: {
      firstName: t("fields.firstName"),
      lastName: t("fields.lastName"),
      displayName: t("fields.displayName"),
      email: t("fields.email"),
      dateOfBirth: t("fields.dateOfBirth"),
      password: t("fields.password"),
    },
    errors: {
      required: t("errors.required"),
      tooLong: t("errors.tooLong"),
      invalid: t("errors.invalid"),
      future: t("errors.future"),
      emailTaken: t("errors.emailTaken"),
      passwordTooLong: t("errors.passwordTooLong"),
    },
    optional: t("optional"),
    submit: t("submit"),
    pending: t("pending"),
    check: t("check"),
    unavailable: t("unavailable"),
    afterSignup: t(uploadIntent ? "afterSignupUpload" : "afterSignup"),
    passwordHint: t("passwordHint"),
    captcha: t("captcha"),
  };
  return (
    <SignupForm
      locale={locale}
      uploadIntent={uploadIntent}
      labels={labels}
      today={new Date().toISOString().slice(0, 10)}
    />
  );
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: SignupQuery;
}) {
  const t = await getTranslations("Signup");
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-lg flex-1 px-5 py-12 sm:px-8 sm:py-16"
    >
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{t("required")}</p>
      <Suspense
        fallback={
          <p role="status" className="mt-7 text-sm text-muted-foreground">
            {t("loading")}
          </p>
        }
      >
        <GuestForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

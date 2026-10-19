import type { Metadata } from "next";
import { Suspense } from "react";
import { SignupLink } from "@/components/signup-link";
import { getTranslations } from "next-intl/server";
import { TrackIllustration } from "@/components/track-illustration";
import { GithubLogoIcon } from "@phosphor-icons/react/dist/ssr/GithubLogo";
import { MapPinAreaIcon } from "@phosphor-icons/react/dist/ssr/MapPinArea";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
    title: t("title"),
    description: t("description"),
    alternates: { languages: { en: "/en", es: "/es" } },
  };
}

const eyebrow = "text-xs font-semibold uppercase tracking-widest text-muted";
const heading = "mt-3 text-3xl font-semibold tracking-tight";
const section = "border-t border-default py-12 sm:py-14";

export default async function Home() {
  const t = await getTranslations("Home");

  return (
    <>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-content px-5 sm:px-8"
      >
        <section
          className="grid items-center gap-10 py-12 md:grid-cols-2 md:gap-12 md:py-20"
          aria-labelledby="hero-title"
        >
          <div>
            <p className={eyebrow}>{t("eyebrow")}</p>
            <h1
              id="hero-title"
              className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl"
            >
              {t("title")}
            </h1>
            <p className="mt-6 text-lg text-muted">{t("description")}</p>
            <p
              className="mt-6 border-l-2 border-accent pl-4 text-sm font-medium"
              role="note"
            >
              {t("notice")}
            </p>
            <p className="mt-4 text-sm text-muted">{t("publicAccess")}</p>
            <Suspense fallback={null}>
              <SignupLink />
            </Suspense>
          </div>
          <figure className="overflow-hidden rounded-2xl border border-default bg-map-background shadow-md">
            <TrackIllustration label={t("mapLabel")} />
            <figcaption className="border-t border-default bg-surface px-5 py-4">
              <p className="text-sm font-semibold">{t("mapCaption")}</p>
              <p className="mt-1 text-xs text-muted">{t("mapDisclosure")}</p>
            </figcaption>
          </figure>
        </section>

        <section
          id="discover"
          className={section}
          aria-labelledby="discover-title"
        >
          <p className={eyebrow}>{t("discover.eyebrow")}</p>
          <h2 id="discover-title" className={heading}>
            {t("discover.title")}
          </h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            {(["place", "direction", "fit"] as const).map((key) => (
              <div key={key}>
                <h3 className="text-xl font-semibold tracking-tight">
                  {t(`discover.${key}.title`)}
                </h3>
                <p className="mt-3 text-muted">
                  {t(`discover.${key}.description`)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section
          id="how-it-works"
          className={section}
          aria-labelledby="how-title"
        >
          <p className={eyebrow}>{t("how.eyebrow")}</p>
          <h2 id="how-title" className={`${heading} max-w-2xl`}>
            {t("how.title")}
          </h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {(["explore", "details", "own"] as const).map((key) => (
              <li key={key}>
                <p className={eyebrow}>{t(`how.${key}.label`)}</p>
                <h3 className="mt-3 text-xl font-semibold tracking-tight">
                  {t(`how.${key}.title`)}
                </h3>
                <p className="mt-3 text-muted">{t(`how.${key}.description`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          id="your-collection"
          className={section}
          aria-labelledby="collection-title"
        >
          <div className="grid gap-8 rounded-xl bg-surface-muted p-6 sm:p-8 md:grid-cols-2 md:gap-12">
            <div>
              <p className={eyebrow}>{t("collection.eyebrow")}</p>
              <h2 id="collection-title" className={heading}>
                {t("collection.title")}
              </h2>
              <p className="mt-5 text-muted">{t("collection.description")}</p>
              <p className="mt-4 text-sm text-muted">
                {t("collection.notice")}
              </p>
            </div>
            <ul className="space-y-5">
              {(["keep", "private", "share", "details"] as const).map((key) => (
                <li key={key} className="border-l-2 border-default pl-4">
                  <h3 className="font-semibold">
                    {t(`collection.${key}.title`)}
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    {t(`collection.${key}.description`)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          id="open-source"
          className={`${section} flex flex-wrap items-center justify-between gap-6`}
          aria-labelledby="open-title"
        >
          <div className="max-w-2xl">
            <p className={eyebrow}>{t("openSource.eyebrow")}</p>
            <h2 id="open-title" className={heading}>
              {t("openSource.title")}
            </h2>
            <p className="mt-4 text-muted">{t("openSource.description")}</p>
          </div>
          <a
            href="https://github.com/ablanco/track-atlas"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent underline underline-offset-4"
          >
            <GithubLogoIcon
              size={16}
              weight="regular"
              aria-hidden="true"
              focusable="false"
              className="shrink-0"
            />{" "}
            {t("openSource.link")}
          </a>
        </section>
      </main>
      <footer className="mx-auto flex w-full max-w-content flex-wrap justify-between gap-3 border-t border-default px-5 py-6 text-xs text-muted sm:px-8">
        <p className="inline-flex items-center gap-1.5">
          <MapPinAreaIcon
            size={16}
            weight="regular"
            aria-hidden="true"
            focusable="false"
            className="shrink-0"
          />
          Track Atlas · {t("footer")}
        </p>
        <p>{t("status")}</p>
      </footer>
    </>
  );
}

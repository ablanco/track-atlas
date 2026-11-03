import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import {
  legalDocuments,
  type LegalDocument,
  getLegalRevision,
} from "@/legal/documents";

type Section = { heading: string; paragraphs: Record<string, string> };
export async function LegalDocumentPage({
  document,
  version,
}: {
  document: string;
  version?: string;
}) {
  const revision = getLegalRevision(document, version);
  if (!revision) notFound();
  const t = await getTranslations("Legal");
  const sectionPrefix = `legal-${await getLocale()}-${document}-${revision.version}-${version ? "revision" : "current"}`;
  const content = await getTranslations(
    `Legal.documents.${document}.${revision.messageKey}`,
  );
  const sections = content.raw("sections") as Record<string, Section>;
  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-3xl px-6 py-10 sm:py-16"
    >
      <article>
        <h1 className="text-3xl font-bold tracking-tight">
          {content("title")}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {t("version", {
            version: revision.version,
            date: revision.effectiveDate,
          })}
        </p>
        <nav
          aria-label={t("contents")}
          className="my-8 rounded-lg border bg-card p-5"
        >
          <ol className="list-inside list-decimal space-y-2">
            {Object.entries(sections).map(([id, section]) => (
              <li key={id}>
                <a
                  className="underline underline-offset-4"
                  href={`#${sectionPrefix}-${id}`}
                >
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div data-legal-text>
          {Object.entries(sections).map(([id, section]) => (
            <section
              key={id}
              aria-labelledby={`${sectionPrefix}-${id}`}
              className="mt-8"
            >
              <h2
                id={`${sectionPrefix}-${id}`}
                className="scroll-mt-6 text-xl font-semibold"
              >
                {section.heading}
              </h2>
              {Object.entries(section.paragraphs).map(([key, text]) => (
                <p key={key} className="mt-3 leading-7">
                  {text}
                </p>
              ))}
            </section>
          ))}
        </div>
      </article>
      <nav
        aria-label={t("history")}
        className="mt-8 space-y-3 border-t pt-5 text-sm"
      >
        <p>
          <Link
            className="underline underline-offset-4"
            href={`/legal/${document}/${revision.version}`}
          >
            {t("permalink")}
          </Link>
        </p>
        {version && (
          <p>
            <Link
              className="underline underline-offset-4"
              href={`/legal/${document}`}
            >
              {t("current")}
            </Link>
          </p>
        )}
        <h2 className="font-semibold">{t("history")}</h2>
        <ul className="flex flex-wrap gap-4">
          {legalDocuments[document as LegalDocument].revisions.map((item) => (
            <li key={item.version}>
              <Link
                className="underline underline-offset-4"
                href={`/legal/${document}/${item.version}`}
              >
                {item.version}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav
        aria-label={t("contact")}
        className="mt-8 flex flex-wrap gap-4 border-t pt-5 text-sm underline underline-offset-4"
      >
        <a href="mailto:privacy@trackatlas.net">{t("contact")}</a>
        <a href="https://www.aepd.es/">{t("authority")}</a>
      </nav>
    </main>
  );
}

export async function legalDocumentMetadata(
  document: string,
  version?: string,
) {
  const revision = getLegalRevision(document, version);
  if (!revision) notFound();
  const t = await getTranslations(
    `Legal.documents.${document}.${revision.messageKey}`,
  );
  return { title: `${t("title")} · Track Atlas` };
}

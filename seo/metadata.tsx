import {
  isSupportedLocale,
  locales,
  localizedAlternates,
} from "@/i18n/locales";
import "server-only";
import type { Metadata } from "next";
import { appOrigin, indexingEnabled } from "./config";

const openGraphLocales = {
  en: "en_US",
  es: "es_ES",
  fr: "fr_FR",
  pt: "pt_PT",
  de: "de_DE",
  it: "it_IT",
};

export function publicMetadata({
  locale,
  path = "",
  title,
  description,
  image = "/images/track-atlas-preview.jpg",
  duplicate = false,
}: {
  locale: string;
  path?: string;
  title: string;
  description: string;
  image?: string;
  duplicate?: boolean;
}): Metadata {
  const origin = appOrigin();
  const url = `${origin}/${locale}${path}`;
  const images = [{ url: `${origin}${image}`, alt: title }];
  return {
    title,
    description,
    robots: {
      index: indexingEnabled() && !duplicate,
      follow: indexingEnabled() && !duplicate,
    },
    alternates: {
      canonical: url,
      languages: localizedAlternates(path, origin),
    },
    openGraph: {
      type: "website",
      siteName: "Track Atlas",
      url,
      title,
      description,
      locale: openGraphLocales[isSupportedLocale(locale) ? locale : "en"],
      alternateLocale: locales
        .filter((value) => value !== locale)
        .map((value) => openGraphLocales[value]),
      images,
    },
    twitter: { card: "summary_large_image", title, description, images },
  };
}
export function excerpt(description: string) {
  const text = description.replace(/\s+/gu, " ").trim();
  const characters = Array.from(text);
  return characters.length > 200
    ? characters.slice(0, 199).join("").trimEnd() + "…"
    : text;
}
export function StructuredData({
  type,
  locale,
  path = "",
  name,
  description,
  image = "/images/track-atlas-preview.jpg",
}: {
  type: "WebSite" | "WebPage";
  locale: string;
  path?: string;
  name: string;
  description: string;
  image?: string;
}) {
  const origin = appOrigin();
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": type,
          name,
          description,
          inLanguage: locale,
          url: `${origin}/${locale}${path}`,
          image: `${origin}${image}`,
        }).replace(/</g, "\\u003c"),
      }}
    />
  );
}

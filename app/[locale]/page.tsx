import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowUpRight";
import { GithubLogoIcon } from "@phosphor-icons/react/dist/ssr/GithubLogo";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { ActivityIcon } from "@/components/activity-icon";
import type { ActivityType } from "@/tracks/validation";
import { HomeSearchDemo, PreviewMap } from "@/components/home-search-demo";
import styles from "@/components/homepage.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
    title: t("title"),
    description: t("description"),
    alternates: { languages: { en: "/en", es: "/es" } },
  };
}
const groups: { key: string; activities: ActivityType[] }[] = [
  {
    key: "foot",
    activities: ["walking", "hiking", "road_running", "trail_running"],
  },
  { key: "bike", activities: ["cycling", "mountain_biking"] },
  {
    key: "snow",
    activities: ["ski_touring", "cross_country_skiing", "snowshoeing"],
  },
  { key: "water", activities: ["paddling"] },
  { key: "horse", activities: ["horse_riding"] },
  {
    key: "motor",
    activities: [
      "four_by_four",
      "road_motorcycling",
      "off_road_motorcycling",
      "atv_quad",
    ],
  },
];
export default async function Home() {
  const t = await getTranslations("Home");
  const tracks = await getTranslations("Tracks.activities");
  const actions = (
    <div className={styles.actions}>
      <Link href="/tracks" className={styles.primary}>
        {t("exploreTracks")}
        <ArrowUpRightIcon size={20} aria-hidden="true" focusable="false" />
      </Link>
      <Link
        href="/tracks/upload?login=1"
        prefetch={false}
        className={styles.secondary}
      >
        {t("upload")}
        <ArrowUpRightIcon size={20} aria-hidden="true" focusable="false" />
      </Link>
    </div>
  );
  return (
    <main data-home id="main-content" tabIndex={-1} className={styles.home}>
      <section className={styles.hero}>
        <div className={styles.heroGrid}>
          <div>
            <p className={styles.eyebrow}>{t("eyebrow")}</p>
            <h1>
              {t("title")}
              <br />
              <span>{t("highlight")}</span>
            </h1>
            <p className={styles.lead}>{t("description")}</p>
            {actions}
            <p className={styles.freeNote}>
              <CheckCircleIcon size={17} aria-hidden="true" focusable="false" />
              {t("freeNote")}
            </p>
          </div>
          <div className={styles.heroPreview}>
            <div className={styles.previewBar}>
              <span className={styles.liveDot} />
              Track Atlas<span>{t("navSearch")}</span>
            </div>
            <PreviewMap />
            <div className={styles.previewLabel}>{t("sample")}</div>
            <div className={styles.trackCard}>
              <span className={styles.trackBadge}>
                <ActivityIcon activity="hiking" size="lg" />
              </span>
              <div>
                <strong>{t("sampleName")}</strong>
                <p>{t("sampleActivity")}</p>
                <small>{t("sampleMetric")}</small>
              </div>
              <ArrowUpRightIcon
                className={styles.cardArrow}
                size={24}
                aria-hidden="true"
                focusable="false"
              />
            </div>
            <div className={styles.directionBadge}>
              {t("sampleMatch")}
              <ArrowUpRightIcon
                size={24}
                aria-hidden="true"
                focusable="false"
              />
            </div>
          </div>
        </div>
        <div className={styles.heroStrip}>
          <span>GPX</span>
          <span>{t("navSearch")}</span>
          <span>{t("navActivities")}</span>
          <span>
            {t("openSource.title")} {t("openSource.highlight")}
          </span>
        </div>
      </section>
      <section id="map-search" className={styles.section}>
        <div className={styles.searchGrid}>
          <div>
            <p className={styles.eyebrow}>{t("search.eyebrow")}</p>
            <h2>
              {t("search.title")}{" "}
              <span className={styles.marker}>{t("search.highlight")}</span>
            </h2>
            <p className={styles.description}>{t("search.description")}</p>
            <Link href="/tracks" className={styles.textLink}>
              {t("search.try")}{" "}
              <ArrowUpRightIcon
                size={20}
                aria-hidden="true"
                focusable="false"
              />
            </Link>
            <div className={styles.filterBlock}>
              <h3>{t("search.filters")}</h3>
              <div className={styles.chips}>
                {["activity", "difficulty", "distance", "elevation"].map(
                  (k) => (
                    <span key={k}>{t(`search.${k}`)}</span>
                  ),
                )}
              </div>
              <p>{t("search.filterText")}</p>
            </div>
          </div>
          <div>
            <HomeSearchDemo />
            <p className={styles.disclosure}>{t("search.approximate")}</p>
          </div>
        </div>
      </section>
      <section id="activities" className={styles.activities}>
        <div className={styles.sectionInner}>
          <p className={styles.eyebrow}>{t("activities.eyebrow")}</p>
          <h2>
            {t("activities.title")}{" "}
            <span className={styles.marker}>{t("activities.highlight")}</span>
          </h2>
          <p className={styles.description}>{t("activities.description")}</p>
          <div className={styles.activityGrid}>
            {groups.map(({ key, activities }, i) => (
              <Link
                key={key}
                href={`/tracks?${new URLSearchParams(activities.map((a) => ["activity", a])).toString()}`}
                className={styles.activityCard}
              >
                <div className={styles.activityTop}>
                  <ActivityIcon activity={activities[0]} size="lg" />
                  <span aria-hidden="true">
                    0{i + 1}{" "}
                    <ArrowUpRightIcon
                      size={16}
                      aria-hidden="true"
                      focusable="false"
                    />
                  </span>
                </div>
                <h3>{t(`activities.${key}`)}</h3>
                <p>{activities.map((a) => tracks(a)).join(" · ")}</p>
              </Link>
            ))}
          </div>
          <Link href="/tracks?activity=other" className={styles.textLink}>
            {t("activities.other")}{" "}
            <ArrowUpRightIcon size={18} aria-hidden="true" focusable="false" />
          </Link>
        </div>
      </section>
      <section className={styles.collection}>
        <div className={styles.landscape}>
          <picture>
            <source
              type="image/avif"
              srcSet="/images/pyrenees-960.avif 960w, /images/pyrenees-1920.avif 1920w"
              sizes="100vw"
            />
            <source
              type="image/webp"
              srcSet="/images/pyrenees-960.webp 960w, /images/pyrenees-1920.webp 1920w"
              sizes="100vw"
            />
            <img
              src="/images/pyrenees-1920.jpg"
              srcSet="/images/pyrenees-960.jpg 960w, /images/pyrenees-1920.jpg 1920w"
              sizes="100vw"
              width={1920}
              height={1280}
              alt=""
              loading="lazy"
              decoding="async"
              className={styles.landscapeImage}
            />
          </picture>
          <div className={styles.landscapeText}>
            <p className={styles.eyebrow}>{t("collection.eyebrow")}</p>
            <h2>
              {t("collection.title")}
              <br />
              {t("collection.highlight")}
            </h2>
          </div>
        </div>
        <div className={styles.collectionPanel}>
          <p className={styles.description}>{t("collection.description")}</p>
          <div className={styles.benefits}>
            {["keep", "private", "organize"].map((key, i) => (
              <div key={key}>
                <div className={styles.benefitHeading}>
                  <span className={styles.number}>0{i + 1}</span>
                  <h3>{t(`collection.${key}`)}</h3>
                </div>
                <p>{t(`collection.${key}Text`)}</p>
              </div>
            ))}
          </div>
          <Link
            href="/tracks/upload?login=1"
            prefetch={false}
            className={styles.textLink}
          >
            {t("upload")}{" "}
            <ArrowUpRightIcon size={20} aria-hidden="true" focusable="false" />
          </Link>
          <p className={styles.disclosure}>{t("collection.notice")}</p>
        </div>
      </section>
      <section
        id="open-source"
        className={`${styles.section} ${styles.openSource}`}
      >
        <p className={styles.eyebrow}>{t("openSource.eyebrow")}</p>
        <h2>
          {t("openSource.title")}
          <br />
          <span className={styles.marker}>{t("openSource.highlight")}</span>
        </h2>
        <p className={styles.description}>{t("openSource.description")}</p>
        <a
          className={styles.textLink}
          href="https://github.com/ablanco/track-atlas"
        >
          <GithubLogoIcon
            size={20}
            weight="regular"
            aria-hidden="true"
            focusable="false"
          />
          {t("openSource.link")}
          <ArrowUpRightIcon size={18} aria-hidden="true" focusable="false" />
        </a>
        <p className={styles.disclosure}>{t("openSource.license")}</p>
      </section>
      <section className={styles.final}>
        <div className={styles.finalInner}>
          <Image
            src="/images/track-atlas-logo.svg"
            alt="Track Atlas"
            width={802}
            height={801}
            unoptimized
            className={styles.finalLogo}
          />
          <div>
            <p className={styles.eyebrow}>{t("final.eyebrow")}</p>
            <h2>
              {t("final.title")}
              <br />
              <span>{t("final.highlight")}</span>
            </h2>
            <p className={styles.lead}>{t("final.description")}</p>
            {actions}
          </div>
        </div>
      </section>
    </main>
  );
}

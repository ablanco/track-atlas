import assert from "node:assert/strict";
import { test } from "node:test";
import { publicMetadata } from "../../seo/metadata";
import { locales } from "../../i18n/locales";

test("public metadata advertises every supported language and the selected regional locale", () => {
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://atlas.example.test";
  try {
    const regions = ["en_US", "es_ES", "fr_FR", "pt_PT", "de_DE", "it_IT"];
    for (const [index, locale] of locales.entries()) {
      const metadata = publicMetadata({
        locale,
        path: "/tracks/example",
        title: "Example",
        description: "Example track",
      });
      assert.equal(
        metadata.alternates?.canonical,
        `https://atlas.example.test/${locale}/tracks/example`,
      );
      assert.deepEqual(
        metadata.alternates?.languages,
        Object.fromEntries(
          locales.map((language) => [
            language,
            `https://atlas.example.test/${language}/tracks/example`,
          ]),
        ),
      );
      assert.equal(metadata.openGraph?.locale, regions[index]);
      assert.deepEqual(
        metadata.openGraph?.alternateLocale,
        regions.filter((region) => region !== regions[index]),
      );
    }
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createTranslator } from "next-intl";

function leaves(value, prefix = "") {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, message]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof message === "string"
        ? [[path, message]]
        : Object.entries(leaves(message, path));
    }),
  );
}
const parameters = (message) =>
  [...message.matchAll(/\{(\w+)(?:,|\})/g)].map((match) => match[1]).sort();
for (const locale of ["en", "es", "fr", "pt", "de", "it"]) {
  test(`${locale} catalog preserves every message, ICU argument, and rich link`, async () => {
    const read = async (language) =>
      JSON.parse(
        await readFile(
          new URL(`../messages/${language}.json`, import.meta.url),
          "utf8",
        ),
      );
    const source = leaves(await read("en"));
    const messages = await read(locale);
    const translated = leaves(messages);
    assert.deepEqual(Object.keys(translated), Object.keys(source));
    const t = createTranslator({
      locale,
      messages,
      onError(error) {
        throw error;
      },
    });
    for (const [key, message] of Object.entries(translated)) {
      assert.ok(message.trim(), key);
      assert.deepEqual(
        parameters(message),
        parameters(source[key]),
        `${locale} ${key}`,
      );
      for (const count of [0, 1, 2, 1.5]) {
        const values = Object.fromEntries(
          parameters(message).map((name) => [
            name,
            name === "date" ? "2026-11-03" : count,
          ]),
        );
        const text = t.rich(key, { ...values, document: (chunks) => chunks });
        assert.equal(typeof text, "string", `${locale} ${key}`);
        assert.ok(text.length, `${locale} ${key}`);
      }
      if (source[key].includes("<document>"))
        assert.match(message, /<document>[^<]+<\/document>/, key);
    }
  });
}

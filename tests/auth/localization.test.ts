import assert from "node:assert/strict";
import { test } from "node:test";
import { locales, normalizeAcceptLanguage } from "../../i18n/locales";
import { safeLegalDestination } from "../../legal/destination";
import { isCurrentLegalAcceptance } from "../../legal/acceptance-input";
import { legalDocuments } from "../../legal/documents";
import { handleRecoveryRequest } from "../../auth/account-email-action";

for (const locale of locales) {
  test(`${locale} legal renewal and recovery preserve the selected language`, async () => {
    const target = `/${locale}/tracks?activity=hiking`;
    assert.equal(safeLegalDestination(target, locale), target);
    assert.equal(
      safeLegalDestination("https://outside.test", locale),
      `/${locale}`,
    );
    assert.equal(
      safeLegalDestination(`/${locale}/reset-password?token=secret`, locale),
      `/${locale}`,
    );
    assert.ok(
      isCurrentLegalAcceptance({
        locale,
        termsVersion: legalDocuments.terms.currentVersion,
        privacyVersion: legalDocuments.privacy.currentVersion,
      }),
    );
    const form = new FormData();
    form.set("email", "localization@example.test");
    let called = false;
    const result = await handleRecoveryRequest(locale, form, {
      prepare() {},
      async request(_email, language) {
        assert.equal(language, locale);
        called = true;
      },
    });
    assert.ok(called);
    assert.ok(result.requested);
  });
}

test("regional browser preferences preserve quality weights, exclusions and unsupported languages", () => {
  assert.equal(normalizeAcceptLanguage("pt-PT,en;q=0.5"), "pt,en;q=0.5");
  assert.equal(
    normalizeAcceptLanguage("pt-BR,fr-CA;q=0.8,de-CH;q=0"),
    "pt,fr;q=0.8,de;q=0",
  );
  assert.equal(
    normalizeAcceptLanguage("nl-NL, EN-us;q=0.7,*;q=0.1"),
    "nl-NL, en;q=0.7,*;q=0.1",
  );
  assert.equal(normalizeAcceptLanguage("pt-@PT;q=0.2"), "pt-@PT;q=0.2");
});

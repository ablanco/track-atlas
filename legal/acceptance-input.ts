import { isSupportedLocale } from "../i18n/locales";
import type { SupportedLocale } from "../i18n/locales";
import { legalDocuments } from "./documents";

export type LegalAcceptanceInput = Readonly<{
  termsVersion: string;
  privacyVersion: string;
  locale: SupportedLocale;
}>;

/** Exact revisions displayed at submission, independently of material generations. */
export function isCurrentLegalAcceptance(input: LegalAcceptanceInput): boolean {
  return (
    !!input &&
    isSupportedLocale(input.locale) &&
    input.termsVersion === legalDocuments.terms.currentVersion &&
    input.privacyVersion === legalDocuments.privacy.currentVersion
  );
}

import { legalDocuments } from "./documents";

export type LegalAcceptanceInput = Readonly<{
  termsVersion: string;
  privacyVersion: string;
  locale: "en" | "es";
}>;

/** Exact revisions displayed at submission, independently of material generations. */
export function isCurrentLegalAcceptance(input: LegalAcceptanceInput): boolean {
  return (
    !!input &&
    (input.locale === "en" || input.locale === "es") &&
    input.termsVersion === legalDocuments.terms.currentVersion &&
    input.privacyVersion === legalDocuments.privacy.currentVersion
  );
}

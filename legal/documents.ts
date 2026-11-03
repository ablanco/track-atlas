/** Published entries and their EN/ES message trees are append-only. */
export type LegalDocument = "terms" | "privacy";
export type LegalRevision = Readonly<{
  version: string;
  requiredVersion: string;
  effectiveDate: string;
  messageKey: string;
}>;

export const legalDocuments: Readonly<
  Record<
    LegalDocument,
    Readonly<{
      currentVersion: string;
      requiredVersion: string;
      revisions: readonly LegalRevision[];
    }>
  >
> = {
  terms: {
    currentVersion: "2026-11-03",
    requiredVersion: "2026-11-03",
    revisions: [
      {
        version: "2026-11-03",
        requiredVersion: "2026-11-03",
        effectiveDate: "2026-11-03",
        messageKey: "r20261103",
      },
    ],
  },
  privacy: {
    currentVersion: "2026-11-03",
    requiredVersion: "2026-11-03",
    revisions: [
      {
        version: "2026-11-03",
        requiredVersion: "2026-11-03",
        effectiveDate: "2026-11-03",
        messageKey: "r20261103",
      },
    ],
  },
};

export function getLegalRevision(
  document: string,
  version?: string,
): LegalRevision | undefined {
  if (!Object.hasOwn(legalDocuments, document)) return undefined;
  const entry = legalDocuments[document as LegalDocument];
  return entry.revisions.find(
    (revision) => revision.version === (version ?? entry.currentVersion),
  );
}

/** Compare recorded exact revisions by material generation, never lexically by date. */
export function hasRequiredLegalRevision(
  document: LegalDocument,
  recordedVersion: string | null | undefined,
): boolean {
  if (!recordedVersion) return false;
  return (
    getLegalRevision(document, recordedVersion)?.requiredVersion ===
    legalDocuments[document].requiredVersion
  );
}

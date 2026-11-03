import { Suspense } from "react";
import Loading from "../../loading";
import {
  LegalDocumentPage,
  legalDocumentMetadata,
} from "@/components/legal-document";
import { legalDocuments } from "@/legal/documents";

export function generateStaticParams() {
  return Object.entries(legalDocuments).flatMap(([document, entry]) =>
    entry.revisions.map(({ version }) => ({ document, version })),
  );
}

async function DocumentContent({
  params,
}: {
  params: Promise<{ document: string; version: string }>;
}) {
  const { document, version } = await params;
  return <LegalDocumentPage document={document} version={version} />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ document: string; version: string }>;
}) {
  const { document, version } = await params;
  return legalDocumentMetadata(document, version);
}

export default function Page({
  params,
}: {
  params: Promise<{ document: string; version: string }>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <DocumentContent params={params} />
    </Suspense>
  );
}

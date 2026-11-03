import { Suspense } from "react";
import Loading from "../loading";
import {
  LegalDocumentPage,
  legalDocumentMetadata,
} from "@/components/legal-document";
import { legalDocuments } from "@/legal/documents";

export function generateStaticParams() {
  return Object.keys(legalDocuments).map((document) => ({ document }));
}

async function DocumentContent({
  params,
}: {
  params: Promise<{ document: string }>;
}) {
  const { document } = await params;
  return <LegalDocumentPage document={document} />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ document: string }>;
}) {
  const { document } = await params;
  return legalDocumentMetadata(document);
}

export default function Page({
  params,
}: {
  params: Promise<{ document: string }>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <DocumentContent params={params} />
    </Suspense>
  );
}

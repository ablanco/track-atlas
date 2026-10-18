import { serveFiles } from "@/storage/http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return serveFiles(request, (await params).id, "avatar");
}

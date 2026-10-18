import { serveFiles } from "@/storage/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return serveFiles(request, (await params).id);
}

export async function DELETE(request: Request, { params }: Context) {
  return serveFiles(request, (await params).id);
}

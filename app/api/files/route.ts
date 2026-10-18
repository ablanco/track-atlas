import { serveFiles } from "@/storage/http";

export async function POST(request: Request) {
  return serveFiles(request);
}

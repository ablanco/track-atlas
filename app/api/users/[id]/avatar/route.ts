import { serveExplore } from "@/tracks/explore-http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return serveExplore(request, { resource: "avatar", id: (await params).id });
}

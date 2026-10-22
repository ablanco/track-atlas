import { serveExplore } from "@/tracks/explore-http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return serveExplore(request, { resource: "geometry", id: (await params).id });
}

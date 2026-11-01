import { serveGpxStudioRequest } from "@/tracks/gpx-studio-http";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return serveGpxStudioRequest(request, (await params).id);
}

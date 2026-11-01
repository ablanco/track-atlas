import {
  serveGpxStudioRequest,
  studioFileHeaders,
} from "@/tracks/gpx-studio-http";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; key: string }> },
) {
  const { id, key } = await params;
  return serveGpxStudioRequest(request, id, key);
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...studioFileHeaders,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}

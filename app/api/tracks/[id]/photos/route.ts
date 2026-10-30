import { servePhotos } from "@/tracks/photos-http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return servePhotos(request, (await params).id);
}

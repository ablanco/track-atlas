import { servePhotos } from "@/tracks/photos-http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { id, photoId } = await params;
  return servePhotos(request, id, photoId);
}

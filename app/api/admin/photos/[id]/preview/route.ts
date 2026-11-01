import { serveAdminPhotoPreview } from "@/tracks/photos-http";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return serveAdminPhotoPreview((await params).id);
}

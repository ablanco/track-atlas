import { serveTrackMutation } from "@/tracks/mutations-http";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return serveTrackMutation(request, (await params).id);
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return serveTrackMutation(request, (await params).id);
}

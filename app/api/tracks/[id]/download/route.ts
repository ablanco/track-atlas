import { serveTracks } from "@/tracks/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return serveTracks(request, (await params).id);
}

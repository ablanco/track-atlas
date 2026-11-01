import { serveVoteRequest } from "@/tracks/votes-http";
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return serveVoteRequest(request, (await params).id);
}

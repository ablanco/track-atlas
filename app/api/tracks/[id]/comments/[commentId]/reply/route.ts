import { serveCommentsRequest } from "@/tracks/comments-http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;
  return serveCommentsRequest(request, id, commentId);
}

import { serveDiscussionAvatar } from "@/tracks/comment-avatar-http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;
  return serveDiscussionAvatar(request, id, commentId, false);
}

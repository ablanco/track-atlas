import { serveCommentsRequest } from "@/tracks/comments-http";
async function handle(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return serveCommentsRequest(request, (await params).id);
}
export { handle as GET, handle as POST };

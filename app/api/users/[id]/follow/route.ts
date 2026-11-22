import { serveFollowRequest } from "@/following/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return serveFollowRequest(request, (await params).id);
}
export const PUT = GET;

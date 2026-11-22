import { serveFollowingAvatar } from "@/following/avatar-http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ uploaderId: string }> },
) {
  return serveFollowingAvatar(request, (await params).uploaderId);
}

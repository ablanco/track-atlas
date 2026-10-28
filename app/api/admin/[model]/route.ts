import { serveAdminRead } from "@/admin/http";
export async function GET(
  request: Request,
  context: { params: Promise<{ model: string }> },
) {
  return serveAdminRead(request, (await context.params).model);
}

import { serveAdminRead } from "@/admin/http";
export async function GET(
  request: Request,
  context: { params: Promise<{ model: string; id: string }> },
) {
  const { model, id } = await context.params;
  return serveAdminRead(request, model, id);
}

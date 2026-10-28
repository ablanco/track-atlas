import { serveAdminRead } from "@/admin/http";
export async function GET(request: Request) {
  return serveAdminRead(request);
}

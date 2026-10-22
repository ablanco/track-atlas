import { serveExplore } from "@/tracks/explore-http";
export async function GET(request: Request) {
  return serveExplore(request);
}

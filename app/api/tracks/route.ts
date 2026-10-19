import { serveTracks } from "@/tracks/http";
export async function POST(request: Request) {
  return serveTracks(request);
}

import { serveLists } from "@/tracks/lists-http";
export async function GET(request: Request) {
  return serveLists(request);
}
export async function POST(request: Request) {
  return serveLists(request);
}

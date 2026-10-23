import { serveLists } from "@/tracks/lists-http";
async function handle(
  request: Request,
  { params }: { params: Promise<{ id: string; trackId: string }> },
) {
  return serveLists(request, await params);
}
export { handle as PUT, handle as DELETE };

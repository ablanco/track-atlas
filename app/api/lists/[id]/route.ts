import { serveLists } from "@/tracks/lists-http";
async function handle(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return serveLists(request, await params);
}
export { handle as GET, handle as PATCH, handle as DELETE };

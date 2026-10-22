import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import type { Database } from "../auth/database";
import { SESSION_COOKIE_NAME } from "../auth/session";
import {
  downloadCollectionAvatar,
  getExploreGeometry,
  getExploreResults,
} from "./explore";
import { parseExploreFilters } from "./explore-query";
import { createObjectStore, type ObjectStore } from "../storage/objects";
import { getStorageConfig } from "../storage/config";
import { trackFailure } from "./http";
import { TrackError, trackIdPattern } from "./validation";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
type Resource = { resource: "geometry" | "avatar"; id: string };
export async function handleExploreRequest(
  request: Request,
  dependencies: {
    db: Pick<Database, "execute">;
    token: string | undefined;
    store?: ObjectStore;
  },
  resource?: Resource,
): Promise<Response> {
  try {
    if (request.method !== "GET")
      return new Response(null, {
        status: 405,
        headers: { ...privateHeaders, Allow: "GET" },
      });
    const params = new URL(request.url).searchParams;
    if (resource) {
      if (params.size) throw new TrackError("invalidRequest");
      if (resource.resource === "avatar") {
        if (!dependencies.store) throw new TrackError("unavailable");
        const { bytes } = await downloadCollectionAvatar({
          db: dependencies.db,
          ownerId: resource.id,
          store: dependencies.store,
        });
        return new Response(new Uint8Array(bytes), {
          headers: {
            ...privateHeaders,
            "Content-Type": "image/webp",
            "Content-Length": String(bytes.length),
            "Content-Disposition": "inline",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        });
      }
      const result = await getExploreGeometry({
        ...dependencies,
        id: resource.id,
      });
      if (!result) throw new TrackError("notFound");
      return Response.json(result, { headers: privateHeaders });
    }
    const ownerId = params.get("ownerId") ?? undefined;
    if (
      params.getAll("ownerId").length > 1 ||
      (ownerId !== undefined && !trackIdPattern.test(ownerId))
    )
      throw new TrackError("invalidRequest");
    params.delete("ownerId");
    const result = await getExploreResults({
      ...dependencies,
      ownerId,
      filters: parseExploreFilters(params),
    });
    if (!result) throw new TrackError("notFound");
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    return trackFailure(error);
  }
}
export async function serveExplore(request: Request, resource?: Resource) {
  try {
    return await handleExploreRequest(
      request,
      {
        db: getDb(),
        token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
        ...(resource?.resource === "avatar"
          ? { store: createObjectStore(getStorageConfig()) }
          : {}),
      },
      resource,
    );
  } catch (error) {
    return trackFailure(error);
  }
}

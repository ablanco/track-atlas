import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { SESSION_COOKIE_NAME } from "../auth/session";
import type { Database } from "../auth/database";
import { readUploadBody, getUploadOrigin } from "../storage/http";
import { TrackListError } from "./list-validation";
import {
  createTrackList,
  getTrackList,
  getTrackLists,
  getTrackListPicker,
  renameTrackList,
  deleteTrackList,
  setTrackListMembership,
} from "./lists";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function listFailure(error: unknown) {
  const code = error instanceof TrackListError ? error.code : "unavailable";
  const statuses = {
    invalidRequest: 400,
    unauthorized: 401,
    notFound: 404,
    duplicateName: 409,
    listLimit: 409,
    trackLimit: 409,
    unavailable: 503,
  };
  return Response.json({ error: code }, { status: statuses[code], headers });
}
async function payload(request: Request) {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers.get("content-type") ?? "",
    ) ||
    (request.headers.get("content-encoding") ?? "identity") !== "identity"
  )
    throw new TrackListError("invalidRequest");
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readUploadBody(request, 32 * 1024),
      ),
    ) as unknown;
  } catch {
    throw new TrackListError("invalidRequest");
  }
}
async function emptyBody(request: Request) {
  const length = request.headers.get("content-length");
  if (length !== null && !/^0+$/.test(length))
    throw new TrackListError("invalidRequest");
  if (!request.body) return;
  try {
    // Read the stream even when the declared length is zero. The shared reader
    // bounds duration/abort handling; a zero-byte budget rejects the first byte.
    await readUploadBody(request, 0);
  } catch {
    throw new TrackListError("invalidRequest");
  }
}
export async function handleListRequest(
  request: Request,
  deps: {
    db: Omit<Database, "$client">;
    token: string | undefined;
    origin: string;
  },
  resource?: { id: string; trackId?: string },
): Promise<Response> {
  try {
    const url = new URL(request.url),
      params = url.searchParams;
    // Explicit resources come from Next's awaited dynamic params. The URL parser
    // also permits exercising the public HTTP adapter without a Next server.
    if (!resource) {
      const match = /^\/api\/lists\/([^/]+)(?:\/tracks\/([^/]+))?$/.exec(
        url.pathname,
      );
      if (match)
        resource = { id: match[1], ...(match[2] ? { trackId: match[2] } : {}) };
    }
    const allowed = resource?.trackId
      ? ["PUT", "DELETE"]
      : resource
        ? ["GET", "PATCH", "DELETE"]
        : ["GET", "POST"];
    if (!allowed.includes(request.method))
      return new Response(null, {
        status: 405,
        headers: { ...headers, Allow: allowed.join(", ") },
      });
    if (
      request.method !== "GET" &&
      (request.headers.get("origin") !== deps.origin ||
        request.headers.get("sec-fetch-site") === "cross-site")
    )
      throw new TrackListError("invalidRequest");
    if (resource) {
      if (params.size) throw new TrackListError("invalidRequest");
      if (resource.trackId) {
        await emptyBody(request);
        await setTrackListMembership({
          ...deps,
          ...resource,
          trackId: resource.trackId,
          present: request.method === "PUT",
        });
        return new Response(null, { status: 204, headers });
      }
      if (request.method === "GET") {
        const list = await getTrackList({ ...deps, id: resource.id });
        if (!list) throw new TrackListError("notFound");
        return Response.json({ list }, { headers });
      }
      if (request.method === "PATCH")
        return Response.json(
          {
            list: await renameTrackList({
              ...deps,
              id: resource.id,
              input: await payload(request),
            }),
          },
          { headers },
        );
      await emptyBody(request);
      await deleteTrackList({ ...deps, id: resource.id });
      return new Response(null, { status: 204, headers });
    }
    if (request.method === "POST") {
      if (params.size) throw new TrackListError("invalidRequest");
      return Response.json(
        {
          list: await createTrackList({
            ...deps,
            input: await payload(request),
          }),
        },
        { status: 201, headers },
      );
    }
    if (
      [...params.keys()].some((k) => !["page", "trackId"].includes(k)) ||
      params.getAll("page").length > 1 ||
      params.getAll("trackId").length > 1 ||
      (params.has("page") && params.has("trackId"))
    )
      throw new TrackListError("invalidRequest");
    if (params.has("trackId"))
      return Response.json(
        await getTrackListPicker({ ...deps, trackId: params.get("trackId")! }),
        { headers },
      );
    if (params.has("page") && !/^[1-9]\d*$/.test(params.get("page")!))
      throw new TrackListError("invalidRequest");
    return Response.json(
      await getTrackLists({ ...deps, page: Number(params.get("page") ?? 1) }),
      { headers },
    );
  } catch (error) {
    return listFailure(error);
  }
}
export async function serveLists(
  request: Request,
  resource?: { id: string; trackId?: string },
) {
  try {
    return await handleListRequest(
      request,
      {
        db: getDb(),
        token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
        origin: getUploadOrigin(),
      },
      resource,
    );
  } catch (error) {
    return listFailure(error);
  }
}

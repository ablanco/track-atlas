import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import type { Database } from "../auth/database";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { getUploadOrigin, readUploadBody } from "../storage/http";
import { deleteTrack, requireTrackOwner, updateTrack } from "./service";
import { TrackError } from "./validation";
import { trackFailure } from "./http";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function handleTrackMutation(
  request: Request,
  dependencies: {
    db: Database;
    token: string | undefined;
    origin: string;
  },
  id: string,
) {
  try {
    if (
      request.headers.get("origin") !== dependencies.origin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new TrackError("forbidden");
    if (new URL(request.url).search) throw new TrackError("invalidRequest");
    await requireTrackOwner(dependencies);
    if (request.method === "DELETE") {
      await deleteTrack({ ...dependencies, id });
      return new Response(null, { status: 204, headers });
    }
    if (request.method === "PATCH") {
      if (
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          request.headers.get("content-type") ?? "",
        ) ||
        (request.headers.get("content-encoding") ?? "identity") !== "identity"
      )
        throw new TrackError("invalidRequest");
      const bytes = await readUploadBody(request, 32 * 1024);
      let input: unknown;
      try {
        input = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        throw new TrackError("invalidRequest");
      }
      const result = await updateTrack({ ...dependencies, id, input });
      return Response.json(result, { headers });
    }
    return new Response(null, {
      status: 405,
      headers: { ...headers, Allow: "PATCH, DELETE" },
    });
  } catch (error) {
    return trackFailure(error);
  }
}
export async function serveTrackMutation(request: Request, id: string) {
  try {
    return await handleTrackMutation(
      request,
      {
        db: getDb(),
        token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
        origin: getUploadOrigin(),
      },
      id,
    );
  } catch (error) {
    return trackFailure(error);
  }
}

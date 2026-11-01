import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import type { Database } from "../auth/database";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { createObjectStore, type ObjectStore } from "../storage/objects";
import { getStorageConfig } from "../storage/config";
import { getUploadOrigin } from "../storage/http";
import { createGpxStudioUrl, readGpxStudioFile } from "./gpx-studio";
import { TrackError } from "./validation";
import { trackFailure } from "./http";

export const studioHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export const studioFileHeaders = {
  ...studioHeaders,
  "Access-Control-Allow-Origin": "https://gpx.studio",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

export async function handleGpxStudioRequest(
  request: Request,
  dependencies: {
    db: Database;
    token: string | undefined;
    origin: string;
    store: ObjectStore;
  },
  id: string,
  fileKey?: string,
) {
  try {
    const params = new URL(request.url).searchParams;
    if (request.method !== "GET") throw new TrackError("invalidRequest");
    if (fileKey !== undefined) {
      if (
        [...params.keys()].length !== 0 ||
        (request.headers.has("origin") &&
          request.headers.get("origin") !== "https://gpx.studio")
      )
        throw new TrackError("notFound");
      const bytes = await readGpxStudioFile({
        ...dependencies,
        id,
        key: fileKey,
      });
      return new Response(new Uint8Array(bytes), {
        headers: {
          ...studioFileHeaders,
          "Content-Type": "application/gpx+xml",
          "Content-Length": String(bytes.length),
          "Content-Disposition": 'inline; filename="track.gpx"',
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
    if (
      request.headers.get("sec-fetch-site") === "cross-site" ||
      (request.headers.has("origin") &&
        request.headers.get("origin") !== dependencies.origin)
    )
      throw new TrackError("forbidden");
    const locale = params.get("locale");
    if (
      [...params.keys()].length !== 1 ||
      !params.has("locale") ||
      (locale !== "en" && locale !== "es")
    )
      throw new TrackError("invalidRequest");
    const location = await createGpxStudioUrl({
      ...dependencies,
      id,
      locale,
    });
    return new Response(null, {
      status: 302,
      headers: { ...studioHeaders, Location: location },
    });
  } catch (error) {
    const response = trackFailure(error);
    for (const [key, value] of Object.entries(
      fileKey !== undefined ? studioFileHeaders : studioHeaders,
    ))
      response.headers.set(key, value);
    return response;
  }
}

export async function serveGpxStudioRequest(
  request: Request,
  id: string,
  fileKey?: string,
) {
  try {
    return await handleGpxStudioRequest(
      request,
      {
        db: getDb(),
        token:
          fileKey !== undefined
            ? undefined
            : (await cookies()).get(SESSION_COOKIE_NAME)?.value,
        origin: getUploadOrigin(),
        store: createObjectStore(getStorageConfig()),
      },
      id,
      fileKey,
    );
  } catch (error) {
    return trackFailure(error);
  }
}

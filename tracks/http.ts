import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import type { Database } from "../auth/database";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { createObjectStore, type ObjectStore } from "../storage/objects";
import { getStorageConfig } from "../storage/config";
import { getUploadOrigin, readUploadBody } from "../storage/http";
import { FileError } from "../storage/validation";
import {
  createTrack,
  downloadTrack,
  downloadTrackAvatar,
  getTrackData,
} from "./service";
import { TrackError } from "./validation";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const statuses = {
  unauthorized: 401,
  emailUnconfirmed: 403,
  invalidRequest: 400,
  invalidMetadata: 422,
  invalidFile: 422,
  unsupportedStructure: 422,
  tooLarge: 413,
  tooManyPoints: 422,
  notFound: 404,
  quotaExceeded: 429,
  forbidden: 403,
  conflict: 409,
  processing: 409,
  processingTimeout: 503,
  unavailable: 503,
};
export function trackFailure(error: unknown) {
  const failure =
    error instanceof TrackError
      ? error
      : error instanceof FileError
        ? new TrackError(
            error.code === "invalidFile" ||
              error.code === "invalidRequest" ||
              error.code === "tooLarge"
              ? error.code
              : "unavailable",
          )
        : new TrackError("unavailable");
  return Response.json(
    {
      error: failure.code,
      ...(failure.fieldErrors ? { fieldErrors: failure.fieldErrors } : {}),
    },
    {
      status: statuses[failure.code],
      headers: {
        ...privateHeaders,
        ...(failure.code === "processing" ? { "Retry-After": "2" } : {}),
      },
    },
  );
}
async function readPayload(request: Request) {
  if ((request.headers.get("content-encoding") ?? "identity") !== "identity")
    throw new TrackError("invalidRequest");
  const contentType = request.headers.get("content-type") ?? "";
  if (
    !/^multipart\/form-data\s*;/i.test(contentType) ||
    contentType.length > 200
  )
    throw new TrackError("invalidRequest");
  const bytes = await readUploadBody(request, 11 * 1024 * 1024);
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    throw new TrackError("invalidRequest");
  }
  const required = [
    "name",
    "description",
    "activity",
    "difficulty",
    "tags",
    "requestId",
    "file",
  ];
  if (
    [...form.keys()].some(
      (key) => ![...required, "visibility"].includes(key),
    ) ||
    required.some((key) => form.getAll(key).length !== 1) ||
    form.getAll("visibility").length > 1 ||
    (form.has("visibility") &&
      !["private", "public"].includes(String(form.get("visibility"))))
  )
    throw new TrackError("invalidRequest");
  function text(key: string, maxBytes: number) {
    const value = form.get(key);
    if (typeof value !== "string") throw new TrackError("invalidRequest");
    const trimmed = value.trim();
    if (Buffer.byteLength(trimmed, "utf8") > maxBytes)
      throw new TrackError("invalidRequest");
    return trimmed;
  }
  let tags: unknown;
  try {
    tags = JSON.parse(text("tags", 2048));
  } catch {
    throw new TrackError("invalidMetadata", { tags: "invalid" });
  }
  const file = form.get("file");
  if (!file || typeof file === "string")
    throw new TrackError("invalidFile", { file: "required" });
  if (file.size > 10 * 1024 * 1024) throw new TrackError("tooLarge");
  return {
    requestId: text("requestId", 36),
    input: {
      name: text("name", 800),
      description: text("description", 20000),
      activity: text("activity", 100),
      difficulty: Number(text("difficulty", 10)),
      tags,
      visibility: form.has("visibility") ? text("visibility", 7) : "private",
    },
    bytes: Buffer.from(await file.arrayBuffer()),
  };
}
export type TrackHttpDependencies = {
  db: Database;
  store: ObjectStore;
  token: string | undefined;
  origin: string;
};
export async function handleTrackRequest(
  request: Request,
  dependencies: TrackHttpDependencies,
  id?: string,
  resource: "download" | "data" | "avatar" = "download",
): Promise<Response> {
  try {
    if (new URL(request.url).search) throw new TrackError("invalidRequest");
    if (request.method === "POST" && id === undefined) {
      if (
        request.headers.get("origin") !== dependencies.origin ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        throw new TrackError("forbidden");
      const result = await createTrack({
        ...dependencies,
        read: () => readPayload(request),
      });
      return Response.json(result, { status: 201, headers: privateHeaders });
    }
    if (request.method === "GET" && id !== undefined) {
      if (resource === "avatar") {
        const { bytes } = await downloadTrackAvatar({ ...dependencies, id });
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
      if (resource === "data") {
        const data = await getTrackData({ ...dependencies, id });
        if (!data) throw new TrackError("notFound");
        return Response.json(data, { headers: privateHeaders });
      }
      const { bytes } = await downloadTrack({ ...dependencies, id });
      return new Response(new Uint8Array(bytes), {
        headers: {
          ...privateHeaders,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(bytes.length),
          "Content-Disposition": 'attachment; filename="track.gpx"',
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
    return new Response(null, {
      status: 405,
      headers: { ...privateHeaders, Allow: id === undefined ? "POST" : "GET" },
    });
  } catch (error) {
    return trackFailure(error);
  }
}
export async function serveTracks(
  request: Request,
  id?: string,
  resource: "download" | "data" | "avatar" = "download",
) {
  try {
    return await handleTrackRequest(
      request,
      {
        db: getDb(),
        store: createObjectStore(getStorageConfig()),
        token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
        origin: getUploadOrigin(),
      },
      id,
      resource,
    );
  } catch (error) {
    return trackFailure(error);
  }
}

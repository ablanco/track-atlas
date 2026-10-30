import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { isSessionToken } from "../auth/session-store";
import type { Database } from "../auth/database";
import { getStorageConfig } from "./config";
import { createObjectStore, type ObjectStore } from "./objects";
import { deleteFile, downloadFile, uploadFile } from "./files";
import {
  FileError,
  isAvatarMediaType,
  parsePurpose,
  uploadPolicies,
} from "./validation";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const statusCodes = {
  unauthorized: 401,
  notFound: 404,
  invalidRequest: 400,
  invalidFile: 422,
  tooLarge: 413,
  quotaExceeded: 429,
  forbidden: 403,
};
type HttpDependencies = {
  db: Database;
  store: ObjectStore;
  token: string | undefined;
  origin: string;
};

export function fileFailure(error: unknown) {
  const code = error instanceof FileError ? error.code : "unavailable";
  return Response.json(
    { error: code },
    {
      status: code === "unavailable" ? 503 : statusCodes[code],
      headers: privateHeaders,
    },
  );
}

export function getUploadOrigin(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  const url = new URL(
    env.APP_ORIGIN ?? (production ? "" : "http://localhost:3000"),
  );
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        !production &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error("Invalid upload origin");
  return url.origin;
}

export async function readUploadBody(
  request: Request,
  maxBytes: number,
): Promise<Buffer> {
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
  )
    throw new FileError("invalidRequest");
  if (length !== null && Number(length) > maxBytes)
    throw new FileError("tooLarge");
  if (!request.body) throw new FileError("invalidFile");
  const reader = request.body.getReader();
  let expired = false;
  const cancel = () => {
    expired = true;
    void reader.cancel().catch(() => {});
  };
  const timeout = setTimeout(cancel, 30_000);
  timeout.unref();
  request.signal.addEventListener("abort", cancel, { once: true });
  const chunks: Buffer[] = [];
  let total = 0;
  let emptyChunks = 0;
  try {
    if (request.signal.aborted) throw new FileError("invalidRequest");
    while (true) {
      const { done, value } = await reader.read();
      if (expired || request.signal.aborted)
        throw new FileError("invalidRequest");
      if (done) break;
      // Empty chunks consume no byte budget and can starve the deadline timer.
      if (!value.byteLength && ++emptyChunks > 1024)
        throw new FileError("invalidRequest");
      total += value.byteLength;
      if (total > maxBytes) throw new FileError("tooLarge");
      if (value.byteLength) chunks.push(Buffer.from(value));
    }
    if (length !== null && total !== Number(length))
      throw new FileError("invalidRequest");
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", cancel);
    // A producer's cancellation hook must not hold the response open.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function handleFileRequest(
  request: Request,
  dependencies: HttpDependencies,
  id?: string,
  representation: "download" | "avatar" = "download",
): Promise<Response> {
  try {
    if (!isSessionToken(dependencies.token))
      throw new FileError("unauthorized");
    if (request.method !== "GET") {
      if (
        request.headers.get("origin") !== dependencies.origin ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        throw new FileError("forbidden");
    }
    if (request.method === "POST" && id === undefined) {
      const params = new URL(request.url).searchParams;
      if (
        [...params.keys()].some((key) => key !== "purpose") ||
        params.getAll("purpose").length !== 1
      )
        throw new FileError("invalidRequest");
      const purpose = parsePurpose(params.get("purpose"));
      const encoding = request.headers.get("content-encoding");
      if (encoding && encoding !== "identity")
        throw new FileError("invalidRequest");
      const contentType =
        request.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() ?? "";
      const file = await uploadFile({
        ...dependencies,
        purpose,
        contentType,
        read: () => readUploadBody(request, uploadPolicies[purpose].maxBytes),
      });
      return Response.json(file, {
        status: 201,
        headers: { ...privateHeaders, Location: file.downloadUrl },
      });
    }
    if (request.method === "GET" && id !== undefined) {
      const inline = representation === "avatar";
      const params = new URL(request.url).searchParams;
      const size = params.get("size") ?? "128";
      if (
        inline &&
        ([...params.keys()].some((key) => key !== "size") ||
          params.getAll("size").length > 1 ||
          !["128", "24"].includes(size))
      )
        throw new FileError("invalidRequest");
      const file = await downloadFile({
        ...dependencies,
        id,
        avatarSize: inline ? (size === "24" ? 24 : 128) : undefined,
      });
      const imageType = file.contentType ?? "";
      if (
        inline &&
        (file.purpose !== "avatar" || !isAvatarMediaType(imageType))
      )
        throw new FileError("notFound");
      const extension =
        imageType === "image/jpeg"
          ? "jpg"
          : imageType.replace(/^image\//, "").replace(/^x-/, "") || "img";
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          ...privateHeaders,
          "Content-Type": inline ? imageType : "application/octet-stream",
          "Content-Length": String(file.byteSize),
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.purpose === "avatar" ? `avatar.${extension}` : file.purpose === "photo" ? "photo-original" : "track.gpx"}"`,
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
    if (request.method === "DELETE" && id !== undefined) {
      await deleteFile({ ...dependencies, id });
      return new Response(null, { status: 204, headers: privateHeaders });
    }
    return new Response(null, {
      status: 405,
      headers: {
        ...privateHeaders,
        Allow: id === undefined ? "POST" : "GET, DELETE",
      },
    });
  } catch (error) {
    return fileFailure(error);
  }
}

export async function serveFiles(
  request: Request,
  id?: string,
  representation: "download" | "avatar" = "download",
) {
  try {
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!isSessionToken(token)) throw new FileError("unauthorized");
    return await handleFileRequest(
      request,
      {
        token,
        db: getDb(),
        store: createObjectStore(getStorageConfig()),
        origin: getUploadOrigin(),
      },
      id,
      representation,
    );
  } catch (error) {
    return fileFailure(error);
  }
}

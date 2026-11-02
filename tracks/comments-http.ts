import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import type { Database } from "../auth/database";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { getUploadOrigin, readUploadBody } from "../storage/http";
import { FileError } from "../storage/validation";
import {
  createOwnerReply,
  createTrackComment,
  DiscussionError,
  getTrackComments,
} from "./comments";
import type { DiscussionErrorCode } from "./comment-types";

export const discussionHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const statuses: Record<DiscussionErrorCode, number> = {
  unauthorized: 401,
  emailUnconfirmed: 403,
  forbidden: 403,
  notFound: 404,
  invalidRequest: 400,
  invalidText: 422,
  tooLarge: 413,
  rateLimited: 429,
  replyExists: 409,
  unavailable: 503,
};
export function discussionFailure(error: unknown) {
  const code =
    error instanceof DiscussionError
      ? error.code
      : error instanceof FileError
        ? error.code === "tooLarge"
          ? "tooLarge"
          : "invalidRequest"
        : "unavailable";
  return Response.json(
    { error: code },
    { status: statuses[code], headers: discussionHeaders },
  );
}
export async function handleCommentsRequest(
  request: Request,
  dependencies: { db: Database; token: string | undefined; origin: string },
  id: string,
  commentId?: string,
) {
  try {
    const params = new URL(request.url).searchParams;
    if (request.method === "GET" && commentId === undefined) {
      if (
        [...params.keys()].some((k) => !["page", "comment"].includes(k)) ||
        params.getAll("page").length > 1 ||
        params.getAll("comment").length > 1 ||
        (params.has("comment") && params.has("page")) ||
        (params.has("page") && !/^[1-9]\d{0,8}$/.test(params.get("page")!))
      )
        throw new DiscussionError("invalidRequest");
      const result = await getTrackComments({
        ...dependencies,
        id,
        page: params.has("page") ? Number(params.get("page")) : 1,
        commentId: params.get("comment") ?? undefined,
      });
      if (!result) throw new DiscussionError("notFound");
      return Response.json(result, { headers: discussionHeaders });
    }
    if (request.method !== "POST")
      return Response.json(
        { error: "invalidRequest" },
        {
          status: 405,
          headers: {
            ...discussionHeaders,
            Allow: commentId === undefined ? "GET, POST" : "POST",
          },
        },
      );
    if (
      request.headers.get("origin") !== dependencies.origin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new DiscussionError("forbidden");
    if (
      params.size ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get("content-type") ?? "",
      ) ||
      (request.headers.get("content-encoding") ?? "identity") !== "identity"
    )
      throw new DiscussionError("invalidRequest");
    const bytes = await readUploadBody(request, 16 * 1024);
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new DiscussionError("invalidRequest");
    }
    const result =
      commentId === undefined
        ? await createTrackComment({ ...dependencies, id, input })
        : await createOwnerReply({ ...dependencies, id, commentId, input });
    return Response.json(result, { status: 201, headers: discussionHeaders });
  } catch (error) {
    return discussionFailure(error);
  }
}
export async function serveCommentsRequest(
  request: Request,
  id: string,
  commentId?: string,
) {
  try {
    return await handleCommentsRequest(
      request,
      {
        db: getDb(),
        token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
        origin: getUploadOrigin(),
      },
      id,
      commentId,
    );
  } catch (error) {
    return discussionFailure(error);
  }
}

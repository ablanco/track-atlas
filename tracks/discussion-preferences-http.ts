import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import type { Database } from "../auth/database";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { getUploadOrigin, readUploadBody } from "../storage/http";
import { DiscussionError } from "./comments";
import { discussionFailure, discussionHeaders } from "./comments-http";
import {
  getDiscussionPreferences,
  updateDiscussionPreferences,
} from "./discussion-preferences";

export async function handleDiscussionPreferencesRequest(
  request: Request,
  dependencies: { db: Database; token: string | undefined; origin: string },
) {
  try {
    if (new URL(request.url).searchParams.size)
      throw new DiscussionError("invalidRequest");
    if (request.method === "GET")
      return Response.json(await getDiscussionPreferences(dependencies), {
        headers: discussionHeaders,
      });
    if (request.method !== "PUT")
      return Response.json(
        { error: "invalidRequest" },
        { status: 405, headers: { ...discussionHeaders, Allow: "GET, PUT" } },
      );
    if (
      request.headers.get("origin") !== dependencies.origin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new DiscussionError("forbidden");
    if (
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get("content-type") ?? "",
      ) ||
      (request.headers.get("content-encoding") ?? "identity") !== "identity"
    )
      throw new DiscussionError("invalidRequest");
    const bytes = await readUploadBody(request, 1024);
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new DiscussionError("invalidRequest");
    }
    return Response.json(
      await updateDiscussionPreferences({ ...dependencies, input }),
      { headers: discussionHeaders },
    );
  } catch (error) {
    return discussionFailure(error);
  }
}

export async function serveDiscussionPreferencesRequest(request: Request) {
  try {
    return await handleDiscussionPreferencesRequest(request, {
      db: getDb(),
      token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
      origin: getUploadOrigin(),
    });
  } catch (error) {
    return discussionFailure(error);
  }
}

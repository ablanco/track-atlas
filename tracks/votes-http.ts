import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import type { Database } from "../auth/database";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { getUploadOrigin, readUploadBody } from "../storage/http";
import { setTrackVote } from "./votes";
import { TrackError } from "./validation";
import { trackFailure } from "./http";

export async function handleVoteRequest(
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
    if (
      request.method !== "PUT" ||
      new URL(request.url).search ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get("content-type") ?? "",
      ) ||
      (request.headers.get("content-encoding") ?? "identity") !== "identity"
    )
      throw new TrackError("invalidRequest");
    const bytes = await readUploadBody(request, 1024);
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new TrackError("invalidRequest");
    }
    return Response.json(await setTrackVote({ ...dependencies, id, input }), {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return trackFailure(error);
  }
}
export async function serveVoteRequest(request: Request, id: string) {
  try {
    return await handleVoteRequest(
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

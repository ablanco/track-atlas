import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { getUploadOrigin, readUploadBody } from "../storage/http";
import { FileError } from "../storage/validation";
import {
  getFollowState,
  setFollowing,
  getFollowing,
  FollowingError,
  type FollowingDependencies,
} from "./service";
import { getDigestPreferences, updateDigestPreferences } from "./preferences";
import type { FollowingErrorCode } from "./types";
export const followingHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const statuses: Record<FollowingErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  invalidRequest: 400,
  tooLarge: 413,
  unavailable: 503,
};
export function followingFailure(error: unknown) {
  const code =
    error instanceof FollowingError
      ? error.code
      : error instanceof FileError
        ? error.code === "tooLarge"
          ? "tooLarge"
          : "invalidRequest"
        : "unavailable";
  return Response.json(
    { error: code },
    { status: statuses[code], headers: followingHeaders },
  );
}
type Dependencies = FollowingDependencies & { origin: string };
async function readInput(request: Request, d: Dependencies) {
  if (
    request.headers.get("origin") !== d.origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new FollowingError("forbidden");
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers.get("content-type") ?? "",
    ) ||
    (request.headers.get("content-encoding") ?? "identity") !== "identity"
  )
    throw new FollowingError("invalidRequest");
  const bytes = await readUploadBody(request, 1024);
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new FollowingError("invalidRequest");
  }
}
function methodFailure(allow: string) {
  return Response.json(
    { error: "invalidRequest" },
    { status: 405, headers: { ...followingHeaders, Allow: allow } },
  );
}
export async function handleFollowRequest(
  request: Request,
  d: Dependencies,
  id: string,
) {
  try {
    if (new URL(request.url).searchParams.size)
      throw new FollowingError("invalidRequest");
    if (request.method === "GET")
      return Response.json(await getFollowState({ ...d, id }), {
        headers: followingHeaders,
      });
    if (request.method !== "PUT") return methodFailure("GET, PUT");
    return Response.json(
      await setFollowing({ ...d, id, input: await readInput(request, d) }),
      { headers: followingHeaders },
    );
  } catch (error) {
    return followingFailure(error);
  }
}
export async function handleFollowingRequest(
  request: Request,
  d: Dependencies,
) {
  try {
    if (request.method !== "GET") return methodFailure("GET");
    const p = new URL(request.url).searchParams;
    if (
      [...p.keys()].some((k) => k !== "page") ||
      p.getAll("page").length > 1 ||
      (p.has("page") && !/^[1-9]\d{0,8}$/.test(p.get("page")!))
    )
      throw new FollowingError("invalidRequest");
    return Response.json(
      await getFollowing({
        ...d,
        page: p.has("page") ? Number(p.get("page")) : 1,
      }),
      { headers: followingHeaders },
    );
  } catch (error) {
    return followingFailure(error);
  }
}
export async function handleDigestPreferencesRequest(
  request: Request,
  d: Dependencies,
) {
  try {
    if (new URL(request.url).searchParams.size)
      throw new FollowingError("invalidRequest");
    if (request.method === "GET")
      return Response.json(await getDigestPreferences(d), {
        headers: followingHeaders,
      });
    if (request.method !== "PUT") return methodFailure("GET, PUT");
    return Response.json(
      await updateDigestPreferences({
        ...d,
        input: await readInput(request, d),
      }),
      { headers: followingHeaders },
    );
  } catch (error) {
    return followingFailure(error);
  }
}
async function dependencies() {
  return {
    db: getDb(),
    token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
    origin: getUploadOrigin(),
  };
}
export async function serveFollowRequest(request: Request, id: string) {
  try {
    return await handleFollowRequest(request, await dependencies(), id);
  } catch (e) {
    return followingFailure(e);
  }
}
export async function serveFollowingRequest(request: Request) {
  try {
    return await handleFollowingRequest(request, await dependencies());
  } catch (e) {
    return followingFailure(e);
  }
}
export async function serveDigestPreferencesRequest(request: Request) {
  try {
    return await handleDigestPreferencesRequest(request, await dependencies());
  } catch (e) {
    return followingFailure(e);
  }
}

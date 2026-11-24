import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { getStorageConfig } from "../storage/config";
import { createObjectStore, type ObjectStore } from "../storage/objects";
import { FollowingError, type FollowingDependencies } from "./service";
import { followingFailure, followingHeaders } from "./http";
import { downloadFollowingAvatar } from "./avatar";
export async function handleFollowingAvatar(
  request: Request,
  d: FollowingDependencies & { store: ObjectStore },
  id: string,
) {
  try {
    if (request.method !== "GET")
      return Response.json(
        { error: "invalidRequest" },
        { status: 405, headers: { ...followingHeaders, Allow: "GET" } },
      );
    if (new URL(request.url).search) throw new FollowingError("invalidRequest");
    const { bytes } = await downloadFollowingAvatar({ ...d, id });
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...followingHeaders,
        "Content-Type": "image/webp",
        "Content-Length": String(bytes.length),
      },
    });
  } catch (e) {
    return followingFailure(e);
  }
}
export async function serveFollowingAvatar(request: Request, id: string) {
  try {
    return await handleFollowingAvatar(
      request,
      {
        db: getDb(),
        token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
        store: createObjectStore(getStorageConfig()),
      },
      id,
    );
  } catch (e) {
    return followingFailure(e);
  }
}

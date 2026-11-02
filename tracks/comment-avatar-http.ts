import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { getStorageConfig } from "../storage/config";
import { createObjectStore } from "../storage/objects";
import { DiscussionError } from "./comments";
import { discussionFailure, discussionHeaders } from "./comments-http";
import { downloadDiscussionAvatar } from "./comment-avatar";

export async function serveDiscussionAvatar(
  request: Request,
  id: string,
  commentId: string,
  reply = false,
) {
  try {
    if (new URL(request.url).search)
      throw new DiscussionError("invalidRequest");
    const { bytes } = await downloadDiscussionAvatar({
      db: getDb(),
      token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
      store: createObjectStore(getStorageConfig()),
      id,
      commentId,
      reply,
    });
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...discussionHeaders,
        "Content-Type": "image/webp",
        "Content-Length": String(bytes.length),
      },
    });
  } catch (error) {
    return discussionFailure(error);
  }
}

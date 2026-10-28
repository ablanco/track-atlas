import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import type { Database } from "../auth/database";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { getUploadOrigin, readUploadBody } from "../storage/http";
import { requireAdmin } from "./auth";
import { mutateAdminRecords } from "./mutations";
import { AdminError } from "./types";
import type { SendEmail } from "../email/types";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function handleAdminMutation(
  request: Request,
  dependencies: {
    db: Pick<Database, "select" | "execute" | "transaction">;
    token: string | undefined;
    origin: string;
    send?: SendEmail;
  },
) {
  try {
    if (request.method !== "POST")
      return Response.json(
        { error: "methodNotAllowed" },
        { status: 405, headers },
      );
    if (
      request.headers.get("origin") !== dependencies.origin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new AdminError("forbidden");
    await requireAdmin(dependencies.db, dependencies.token);
    const locale = request.headers.get("x-admin-locale") ?? "en";
    if (locale !== "en" && locale !== "es")
      throw new AdminError("invalidRequest");
    if (
      new URL(request.url).search ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get("content-type") ?? "",
      ) ||
      (request.headers.get("content-encoding") ?? "identity") !== "identity"
    )
      throw new AdminError("invalidRequest");
    let input: unknown;
    try {
      const bytes = await readUploadBody(request, 64 * 1024);
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new AdminError("invalidRequest");
    }
    return Response.json(
      await mutateAdminRecords(dependencies.db, dependencies.token, input, {
        locale,
        send: dependencies.send,
      }),
      { headers },
    );
  } catch (error) {
    const code = error instanceof AdminError ? error.code : "unavailable";
    return Response.json(
      { error: code },
      {
        status: {
          unauthorized: 401,
          forbidden: 403,
          invalidRequest: 400,
          notFound: 404,
          unavailable: 503,
        }[code],
        headers,
      },
    );
  }
}
export async function serveAdminMutation(request: Request) {
  try {
    return await handleAdminMutation(request, {
      db: getDb(),
      token: (await cookies()).get(SESSION_COOKIE_NAME)?.value,
      origin: getUploadOrigin(),
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}

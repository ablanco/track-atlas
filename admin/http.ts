import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import type { Database } from "../auth/database";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { AdminError } from "./types";
import { getAdminOverview, getAdminRecord, listAdminRecords } from "./queries";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function handleAdminRead(
  request: Request,
  db: Pick<Database, "select" | "execute">,
  token: string | undefined,
  model?: string,
  id?: string,
) {
  try {
    if (request.method !== "GET")
      return Response.json(
        { error: "methodNotAllowed" },
        { status: 405, headers },
      );
    const params = new URL(request.url).searchParams;
    if (!model && params.size) throw new AdminError("invalidRequest");
    const result = !model
      ? await getAdminOverview(db, token)
      : id === undefined
        ? await listAdminRecords(db, token, model, params)
        : await getAdminRecord(db, token, model, id, params);
    return Response.json(result, { headers });
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
export async function serveAdminRead(
  request: Request,
  model?: string,
  id?: string,
) {
  return handleAdminRead(
    request,
    getDb(),
    (await cookies()).get(SESSION_COOKIE_NAME)?.value,
    model,
    id,
  );
}

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { findSessionUser } from "../../auth/session-store";
import { sessionCookieOptions } from "../../auth/session";
import type { AuthExecutor } from "../../auth/database";

test("cookies are host-only, HTTP-only, fixed-expiry and secure in production only", () => {
  const expires = new Date("2026-11-14T12:00:00Z");
  for (const production of [false, true]) assert.deepEqual(sessionCookieOptions(expires, production), { httpOnly: true, sameSite: "lax", secure: production, path: "/", expires });
});

test("invalid session tokens need no database connection; infrastructure errors propagate", async () => {
  const unavailable = { select() { throw new Error("database unavailable"); } } as unknown as AuthExecutor;
  for (const token of [undefined, "", "malformed", "a".repeat(10000), "a".repeat(42) + "_"]) assert.equal(await findSessionUser(unavailable, token), null);
  await assert.rejects(findSessionUser(unavailable, randomBytes(32).toString("base64url")), /database unavailable/);
});

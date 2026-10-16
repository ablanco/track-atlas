import "server-only";
import { randomBytes, createHash } from "node:crypto";
export function hashAccountToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function createAccountToken() { const token = randomBytes(32).toString("base64url"); return { token, tokenHash: hashAccountToken(token) }; }
export function isAccountToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, "base64url").toString("base64url") === value;
}

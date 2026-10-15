import "server-only";
import { createHash, randomInt } from "node:crypto";
import { createChallenge, verifySolution, type Payload } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/sha";
import { captchaUses } from "../db/schema";
import type { AuthExecutor } from "./database";

export function getCaptchaSecret(): string {
  const secret = process.env.ALTCHA_HMAC_SECRET;
  if (!secret || secret.trim().length < 32) throw new Error("ALTCHA_HMAC_SECRET must contain at least 32 characters");
  return secret;
}

export function issueSignupChallenge(secret: string) {
  return createChallenge({
    algorithm: "SHA-256",
    cost: 1,
    counter: randomInt(25_000, 75_001),
    deriveKey,
    expiresAt: new Date(Date.now() + 300_000),
    data: { purpose: "signup" },
    hmacSignatureSecret: secret,
  });
}

function parseProof(form: FormData): Payload | null {
  const entries = form.getAll("altcha");
  if (entries.length !== 1 || typeof entries[0] !== "string" || entries[0].length > 8192) return null;
  try {
    const payload = JSON.parse(Buffer.from(entries[0], "base64").toString("utf8"));
    const parameters = payload?.challenge?.parameters;
    const solution = payload?.solution;
    if (!parameters || !solution || !/^[0-9a-f]{64}$/.test(payload.challenge.signature ?? "") ||
      parameters.algorithm !== "SHA-256" || parameters.cost !== 1 || parameters.keyLength !== 32 ||
      !/^[0-9a-f]{32}$/.test(parameters.nonce ?? "") || !/^[0-9a-f]{32}$/.test(parameters.salt ?? "") ||
      !/^[0-9a-f]{32}$/.test(parameters.keyPrefix ?? "") || parameters.data?.purpose !== "signup" ||
      !Number.isInteger(parameters.expiresAt) || parameters.expiresAt <= Date.now() / 1000 ||
      parameters.expiresAt > Math.floor(Date.now() / 1000) + 300 ||
      !Number.isInteger(solution.counter) || solution.counter < 0 || solution.counter > 0xffffffff ||
      !/^[0-9a-f]{64}$/.test(solution.derivedKey ?? "")) return null;
    return payload;
  } catch { return null; }
}

export async function verifySignupCaptcha(db: AuthExecutor, form: FormData, secret: string): Promise<boolean> {
  const payload = parseProof(form);
  if (!payload) return false;
  try {
    const verification = await verifySolution({ ...payload, deriveKey, hmacSignatureSecret: secret });
    if (!verification.verified) return false;
  } catch { return false; }
  // A unique insert is atomic across requests/instances; don't use a check-then-set
  // or a per-process cache. Store failures propagate so signup fails closed.
  const consumed = await db.insert(captchaUses).values({
    challengeHash: createHash("sha256").update(payload.challenge.signature!).digest("hex"),
    expiresAt: new Date(payload.challenge.parameters.expiresAt! * 1000),
  }).onConflictDoNothing().returning({ challengeHash: captchaUses.challengeHash });
  return consumed.length === 1;
}

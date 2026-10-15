import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { createChallenge, solveChallenge, type Challenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/sha";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import { captchaUses } from "../../db/schema";
import { issueSignupChallenge, verifySignupCaptcha } from "../../auth/captcha";
import { authTransaction } from "./auth-helpers";

loadEnvConfig(process.cwd(), true);
const { pool, db } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
const secret = randomBytes(32).toString("hex");
async function proof(challenge: Challenge) {
  const solution = await solveChallenge({ challenge, deriveKey });
  assert.ok(solution);
  const form = new FormData();
  form.set("altcha", Buffer.from(JSON.stringify({ challenge, solution })).toString("base64"));
  return form;
}
async function fixture(overrides: Partial<Parameters<typeof createChallenge>[0]> = {}) {
  return createChallenge({ algorithm: "SHA-256", cost: 1, counter: 3, deriveKey, expiresAt: new Date(Date.now() + 300_000), data: { purpose: "signup" }, hmacSignatureSecret: secret, ...overrides });
}

test("issued signup challenges are signed, unique, purpose-bound and expire in five minutes", async () => {
  const before = Math.floor(Date.now() / 1000);
  const first = await issueSignupChallenge(secret);
  const second = await issueSignupChallenge(secret);
  assert.notEqual(first.parameters.nonce, second.parameters.nonce);
  assert.equal(first.parameters.data?.purpose, "signup");
  assert.ok(first.signature);
  assert.ok(first.parameters.expiresAt! >= before + 299 && first.parameters.expiresAt! <= before + 301);
  assert.ok(!JSON.stringify(first).includes(secret));
});

test("valid proof is accepted exactly once and stores no form data", async (t) => {
  const { db: tx } = await authTransaction(t, pool);
  const challenge = await issueSignupChallenge(secret);
  const form = await proof(challenge);
  assert.equal(await verifySignupCaptcha(tx, form, secret), true);
  assert.equal(await verifySignupCaptcha(tx, form, secret), false);
  const [row] = await tx.select().from(captchaUses).where(eq(captchaUses.challengeHash, createHash("sha256").update(challenge.signature!).digest("hex")));
  assert.ok(row);
  assert.equal(row.expiresAt.getTime(), challenge.parameters.expiresAt! * 1000);
  assert.ok(row.createdAt instanceof Date && row.updatedAt instanceof Date);
  assert.equal(Object.keys(row).length, 4);
});

test("concurrent use of the same proof has exactly one winner", async () => {
  const challenge = await fixture();
  const form = await proof(challenge);
  const digest = createHash("sha256").update(challenge.signature!).digest("hex");
  try {
    const results = await Promise.all([verifySignupCaptcha(db, form, secret), verifySignupCaptcha(db, form, secret)]);
    assert.deepEqual(results.sort(), [false, true]);
  } finally { await db.delete(captchaUses).where(eq(captchaUses.challengeHash, digest)); }
});

for (const kind of ["expired", "tampered", "wrong-secret", "wrong-purpose", "invalid-solution"]) test(`rejects ${kind} proof`, async (t) => {
  const { db: tx } = await authTransaction(t, pool);
  const challenge = await fixture(kind === "expired" ? { expiresAt: new Date(Date.now() - 1000) } : kind === "wrong-purpose" ? { data: { purpose: "other" } } : {});
  const form = await proof(challenge);
  if (kind === "tampered") {
    const payload = JSON.parse(Buffer.from(form.get("altcha") as string, "base64").toString());
    payload.challenge.parameters.expiresAt += 1000;
    form.set("altcha", Buffer.from(JSON.stringify(payload)).toString("base64"));
  }
  if (kind === "invalid-solution") {
    const payload = JSON.parse(Buffer.from(form.get("altcha") as string, "base64").toString());
    payload.solution.derivedKey = "00".repeat(32);
    form.set("altcha", Buffer.from(JSON.stringify(payload)).toString("base64"));
  }
  assert.equal(await verifySignupCaptcha(tx, form, kind === "wrong-secret" ? "other-secret".repeat(4) : secret), false);
  assert.equal((await tx.select().from(captchaUses).where(eq(captchaUses.challengeHash, createHash("sha256").update(challenge.signature!).digest("hex")))).length, 0);
});

for (const kind of ["missing", "malformed", "oversized", "duplicate", "file"]) test(`rejects ${kind} CAPTCHA field without database work`, async () => {
  const form = new FormData();
  if (kind === "malformed") form.set("altcha", "not-base64");
  if (kind === "oversized") form.set("altcha", "a".repeat(8193));
  if (kind === "duplicate") { form.append("altcha", "one"); form.append("altcha", "two"); }
  if (kind === "file") form.set("altcha", new File(["payload"], "proof.txt"));
  const unavailable = new Proxy(db, { get() { throw new Error("must not access DB"); } });
  assert.equal(await verifySignupCaptcha(unavailable, form, secret), false);
});

test("captcha-use rows have the required direct-SQL audit trigger", async (t) => {
  const { client, db: tx } = await authTransaction(t, pool);
  const challenge = await fixture();
  await verifySignupCaptcha(tx, await proof(challenge), secret);
  const updated = await client.query("UPDATE captcha_uses SET expires_at=expires_at + interval '1 second' WHERE challenge_hash=$1 RETURNING updated_at > created_at AS advanced", [createHash("sha256").update(challenge.signature!).digest("hex")]);
  assert.equal(updated.rows[0].advanced, true);
});

test("proof-store failure propagates instead of accepting a valid CAPTCHA", async () => {
  const challenge = await fixture();
  const form = await proof(challenge);
  const unavailable = new Proxy(db, { get() { throw new Error("proof store unavailable"); } });
  await assert.rejects(verifySignupCaptcha(unavailable, form, secret), /proof store unavailable/);
});

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import { sessions, users } from "../../db/schema";
import { hashPassword } from "../../auth/password";
import { loginUser } from "../../auth/login";
import { createSession, findSessionUser, revokeSession } from "../../auth/session-store";
import { signupFixture } from "./auth-helpers";
import type { AuthDatabase } from "../../auth/database";

loadEnvConfig(process.cwd(), true);
const { pool, db } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
const encoded = hashPassword(" x ");
async function fixture(work: (user: typeof users.$inferSelect, input: ReturnType<typeof signupFixture>) => Promise<void>, overrides = {}) {
  const input = signupFixture();
  const [user] = await db.insert(users).values({ ...input, passwordHash: await encoded, ...overrides }).returning();
  try { await work(user, input); } finally { await db.delete(users).where(eq(users.id, user.id)); }
}
test("case-insensitive login signs in an unconfirmed account with a new opaque session", async () => {
  await fixture(async (user, input) => {
    assert.equal(user.emailConfirmed, false);
    const result = await loginUser(db, { email: input.email.toUpperCase(), password: " x " });
    assert.equal(result.ok, true); if (!result.ok) return;
    assert.deepEqual(await findSessionUser(db, result.session.token), { userId: user.id, firstName: "Ada", lastName: "Lovelace", displayName: null });
    assert.ok(!JSON.stringify(result).includes(user.passwordHash));
  });
});
for (const kind of ["wrong-password", "unknown", "inactive", "bad-hash"]) test(`${kind} login returns identical invalid-credential reason and no session`, async () => {
  await fixture(async (user, input) => {
    assert.deepEqual(await loginUser(db, { email: kind === "unknown" ? `unknown-${input.email}` : input.email, password: kind === "wrong-password" ? "wrong" : " x " }), { ok: false, reason: "invalidCredentials" });
    assert.equal((await db.select().from(sessions).where(eq(sessions.userId, user.id))).length, 0);
  }, kind === "inactive" ? { active: false } : kind === "bad-hash" ? { passwordHash: "synthetic" } : {});
});
test("login rotates only supplied session; logout revokes only the current session", async () => {
  await fixture(async (user, input) => {
    const old = await createSession(db, user.id), other = await createSession(db, user.id);
    const result = await loginUser(db, input, old.token); assert.equal(result.ok, true); if (!result.ok) return;
    assert.notEqual(result.session.token, old.token);
    assert.equal(await findSessionUser(db, old.token), null);
    assert.equal((await findSessionUser(db, other.token))?.userId, user.id);
    await revokeSession(db, result.session.token); await revokeSession(db, result.session.token);
    assert.equal(await findSessionUser(db, result.session.token), null);
    assert.equal((await findSessionUser(db, other.token))?.userId, user.id);
  });
});
test("stale or malformed prior session does not prevent login", async () => {
  await fixture(async (_user, input) => {
    for (const token of ["bad", "A".repeat(43)]) assert.equal((await loginUser(db, input, token)).ok, true);
  });
  const unavailable = new Proxy(db, { get() { throw new Error("no DB access allowed"); } });
  for (const token of [undefined, "bad"]) await revokeSession(unavailable, token);
});
test("failed session creation rolls back revocation and reports unavailable", async () => {
  await fixture(async (user, input) => {
    const old = await createSession(db, user.id);
    const failing = new Proxy(db, { get(target, key, receiver) {
      if (key !== "transaction") return Reflect.get(target, key, receiver);
      return ((callback) => target.transaction(async (tx) => callback(new Proxy(tx, { get(transaction, property, proxy) {
        if (property === "insert") return () => { throw new Error("private SQL"); };
        return Reflect.get(transaction, property, proxy);
      } })))) as typeof db.transaction;
    } });
    assert.deepEqual(await loginUser(failing, input, old.token), { ok: false, reason: "unavailable" });
    assert.equal((await findSessionUser(db, old.token))?.userId, user.id);
  });
});
test("account disabled between password lookup and transaction cannot get a session", async () => {
  await fixture(async (user, input) => {
    const disabled = new Proxy(db, { get(target, key, receiver) {
      if (key !== "transaction") return Reflect.get(target, key, receiver);
      return (async (callback) => {
        await db.update(users).set({ active: false }).where(eq(users.id, user.id));
        return target.transaction(callback);
      }) as AuthDatabase["transaction"];
    } });
    assert.deepEqual(await loginUser(disabled, input), { ok: false, reason: "invalidCredentials" });
    assert.equal((await db.select().from(sessions).where(eq(sessions.userId, user.id))).length, 0);
  });
});

test("changed credentials during verification cannot issue a session", async () => {
  await fixture(async (user, input) => {
    const changed = new Proxy(db, { get(target, key, receiver) {
      if (key !== "transaction") return Reflect.get(target, key, receiver);
      return (async (callback) => {
        await db.update(users).set({ passwordHash: "changed hash" }).where(eq(users.id, user.id));
        return target.transaction(callback);
      }) as AuthDatabase["transaction"];
    } });
    assert.deepEqual(await loginUser(changed, input), { ok: false, reason: "invalidCredentials" });
    assert.equal((await db.select().from(sessions).where(eq(sessions.userId, user.id))).length, 0);
  });
});

test("login fails safely when shared hashing capacity is full", async () => {
  await fixture(async (user, input) => {
    const work = [hashPassword("first"), hashPassword("second")];
    const result = await loginUser(db, input);
    await Promise.all(work);
    assert.deepEqual(result, { ok: false, reason: "unavailable" });
    assert.equal((await db.select().from(sessions).where(eq(sessions.userId, user.id))).length, 0);
  });
});

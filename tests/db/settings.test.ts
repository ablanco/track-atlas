import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import { sessions, users } from "../../db/schema";
import { hashPassword, verifyPassword } from "../../auth/password";
import { loginUser } from "../../auth/login";
import { createSession, findSessionUser, revokeSession } from "../../auth/session-store";
import { getSettingsProfile, updateProfile, updatePassword, deactivateAccount } from "../../auth/settings";
import { signupFixture } from "./auth-helpers";
import type { Database } from "../../auth/database";

loadEnvConfig(process.cwd(), true);
const { pool, db } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
const encoded = hashPassword("old password");
const changes = { firstName: "Grace", lastName: "Hopper", displayName: "Admiral" };
async function fixture(work: (user: typeof users.$inferSelect, token: string) => Promise<void>) {
  const [user] = await db.insert(users).values({ ...signupFixture(), passwordHash: await encoded, avatarUrl: "https://example.test/avatar" }).returning();
  try { await work(user, (await createSession(db, user.id)).token); }
  finally { await db.delete(users).where(eq(users.id, user.id)); }
}
function beforeTransaction(work: () => Promise<unknown>) {
  return new Proxy(db, { get(target, key, receiver) {
    if (key !== "transaction") return Reflect.get(target, key, receiver);
    return (async (callback) => { await work(); return target.transaction(callback); }) as Database["transaction"];
  } });
}
function brokenDeletion() {
  return new Proxy(db, { get(target, key, receiver) {
    if (key !== "transaction") return Reflect.get(target, key, receiver);
    return ((callback) => target.transaction(tx => callback(new Proxy(tx, { get(transaction, property, proxy) {
      if (property === "delete") return () => { throw new Error("private database details"); };
      return Reflect.get(transaction, property, proxy);
    } })))) as Database["transaction"];
  } });
}
test("settings read selects only safe profile fields", async () => {
  await fixture(async (user, token) => {
    assert.deepEqual(await getSettingsProfile(db, token), { firstName: "Ada", lastName: "Lovelace", displayName: "", email: user.email, dateOfBirth: "1815-12-10" });
    await db.update(users).set({ displayName: "Countess" }).where(eq(users.id, user.id));
    assert.equal((await getSettingsProfile(db, token))?.displayName, "Countess");
  });
});
test("profile updates only name fields and advances database audit time", async () => {
  await fixture(async (user, token) => {
    const other = await createSession(db, user.id);
    assert.deepEqual(await updateProfile(db, token, changes), { ok: true });
    const [updated] = await db.select().from(users).where(eq(users.id, user.id));
    assert.deepEqual({ ...updated, firstName: user.firstName, lastName: user.lastName, displayName: user.displayName, updatedAt: user.updatedAt }, user);
    assert.ok(updated.updatedAt > user.updatedAt);
    assert.deepEqual(await getSettingsProfile(db, token), { ...changes, email: user.email, dateOfBirth: "1815-12-10" });
    assert.ok(await findSessionUser(db, other.token));
    assert.deepEqual(await updateProfile(db, token, { ...changes, displayName: null }), { ok: true });
    assert.equal((await getSettingsProfile(db, token))?.displayName, "");
  });
});
for (const kind of ["missing", "malformed", "unknown", "expired", "revoked", "inactive"] as const) test(`settings reject ${kind} session for every operation`, async () => {
  await fixture(async (user, valid) => {
    const token = kind === "missing" ? undefined : kind === "malformed" ? "bad" : kind === "unknown" ? "A".repeat(43) : valid;
    if (kind === "expired") await db.update(sessions).set({ expiresAt: new Date(0) }).where(eq(sessions.userId, user.id));
    if (kind === "revoked") await revokeSession(db, valid);
    if (kind === "inactive") await db.update(users).set({ active: false }).where(eq(users.id, user.id));
    assert.equal(await getSettingsProfile(db, token), null);
    assert.deepEqual(await updateProfile(db, token, changes), { ok: false, reason: "unauthorized" });
    assert.deepEqual(await updatePassword(db, token, { password: "new password" }), { ok: false, reason: "unauthorized" });
    assert.deepEqual(await deactivateAccount(db, token), { ok: false, reason: "unauthorized" });
    const [unchanged] = await db.select().from(users).where(eq(users.id, user.id));
    assert.equal(unchanged.firstName, "Ada"); assert.equal(unchanged.passwordHash, user.passwordHash);
  });
});
test("password change preserves current session and expiry, revokes others and changes credentials", async () => {
  await fixture(async (user, token) => {
    const other = await createSession(db, user.id);
    const [current] = await db.select().from(sessions).where(eq(sessions.tokenHash, createHash("sha256").update(token).digest("hex")));
    assert.deepEqual(await updatePassword(db, token, { password: " new password " }), { ok: true });
    const [updated] = await db.select().from(users).where(eq(users.id, user.id));
    assert.notEqual(updated.passwordHash, user.passwordHash);
    assert.equal(await verifyPassword(" new password ", updated.passwordHash), true);
    assert.equal(await verifyPassword("new password", updated.passwordHash), false);
    assert.ok(await findSessionUser(db, token)); assert.equal(await findSessionUser(db, other.token), null);
    assert.deepEqual(await db.select().from(sessions).where(eq(sessions.userId, user.id)), [current]);
    assert.deepEqual(await loginUser(db, { email: user.email, password: "old password" }), { ok: false, reason: "invalidCredentials" });
    assert.equal((await loginUser(db, { email: user.email, password: " new password " })).ok, true);
  });
});
test("deactivation retains disabled account and email, removes every session and blocks login", async () => {
  await fixture(async (user, token) => {
    const other = await createSession(db, user.id);
    assert.deepEqual(await deactivateAccount(db, token), { ok: true });
    const [disabled] = await db.select().from(users).where(eq(users.id, user.id));
    assert.equal(disabled.active, false); assert.equal(disabled.email, user.email); assert.equal(disabled.passwordHash, user.passwordHash);
    assert.ok(disabled.updatedAt > user.updatedAt);
    assert.deepEqual(await db.select().from(sessions).where(eq(sessions.userId, user.id)), []);
    assert.equal(await findSessionUser(db, other.token), null);
    assert.deepEqual(await loginUser(db, { email: user.email, password: "old password" }), { ok: false, reason: "invalidCredentials" });
    assert.deepEqual(await deactivateAccount(db, token), { ok: false, reason: "unauthorized" });
    await assert.rejects(db.insert(users).values({ ...signupFixture(), email: user.email, passwordHash: user.passwordHash }));
  });
});
for (const operation of ["password", "deactivation"] as const) test(`${operation} rolls back user update if session revocation fails`, async () => {
  await fixture(async (user, token) => {
    const result = operation === "password" ? await updatePassword(brokenDeletion(), token, { password: "changed" }) : await deactivateAccount(brokenDeletion(), token);
    assert.deepEqual(result, { ok: false, reason: "unavailable" });
    assert.deepEqual((await db.select().from(users).where(eq(users.id, user.id)))[0], user);
    assert.ok(await findSessionUser(db, token));
  });
});
test("request token cannot mutate another account through injected profile properties", async () => {
  await fixture(async (_first, token) => fixture(async (second) => {
    assert.deepEqual(await updateProfile(db, token, { ...changes, userId: second.id, email: "other@example.test", active: false, admin: true } as typeof changes), { ok: true });
    assert.deepEqual((await db.select().from(users).where(eq(users.id, second.id)))[0], second);
    const current = await findSessionUser(db, token);
    assert.equal(current?.firstName, "Grace");
    const [owner] = await db.select().from(users).where(eq(users.id, current!.userId));
    assert.equal(owner.active, true); assert.equal(owner.admin, false); assert.notEqual(owner.email, "other@example.test");
  }));
});
for (const operation of ["profile", "password", "deactivation"] as const) test(`${operation} rechecks session after preflight and hashing`, async () => {
  await fixture(async (user, token) => {
    const interrupted = beforeTransaction(() => revokeSession(db, token));
    const result = operation === "profile" ? await updateProfile(interrupted, token, changes) : operation === "password" ? await updatePassword(interrupted, token, { password: "changed" }) : await deactivateAccount(interrupted, token);
    assert.deepEqual(result, { ok: false, reason: "unauthorized" });
    assert.deepEqual((await db.select().from(users).where(eq(users.id, user.id)))[0], user);
  });
});
for (const kind of ["revoked", "expired", "disabled"] as const) test(`authorization rechecks ${kind} session after waiting for user lock`, async () => {
  await fixture(async (user, token) => {
    const client = await pool.connect();
    const locked = Promise.withResolvers<void>();
    let armed = true;
    const instrumented = new Proxy(db, { get(target, key, receiver) {
      if (key !== "transaction") return Reflect.get(target, key, receiver);
      return ((callback) => target.transaction(tx => callback(new Proxy(tx, { get(transaction, property, proxy) {
        if (property !== "select") return Reflect.get(transaction, property, proxy);
        return (...args: Parameters<typeof tx.select>) => {
          const query = tx.select(...args);
          // Observe the real user's SELECT FOR UPDATE without replacing its SQL/effects.
          const from = query.from.bind(query);
          query.from = ((...fromArgs: Parameters<typeof query.from>) => {
            const builder = from(...fromArgs);
            const lock = builder.for.bind(builder);
            builder.for = ((...lockArgs: Parameters<typeof builder.for>) => {
              if (armed) { armed = false; locked.resolve(); }
              return lock(...lockArgs);
            }) as typeof builder.for;
            return builder;
          }) as typeof query.from;
          return query;
        };
      } })))) as Database["transaction"];
    } });
    try {
      await client.query("BEGIN"); await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
      const pending = updateProfile(instrumented, token, changes);
      await locked.promise;
      if (kind === "revoked") await client.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
      if (kind === "expired") await client.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [user.id]);
      if (kind === "disabled") await client.query("UPDATE users SET active=false WHERE id=$1", [user.id]);
      await client.query("COMMIT");
      assert.deepEqual(await pending, { ok: false, reason: "unauthorized" });
      assert.equal((await db.select().from(users).where(eq(users.id, user.id)))[0].firstName, "Ada");
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
});
for (const kind of ["password", "deactivation"] as const) test(`login cannot issue a session with stale credentials across ${kind}`, async () => {
  await fixture(async (user, token) => {
    const interrupted = beforeTransaction(() => kind === "password" ? updatePassword(db, token, { password: "changed" }) : deactivateAccount(db, token));
    assert.deepEqual(await loginUser(interrupted, { email: user.email, password: "old password" }), { ok: false, reason: "invalidCredentials" });
    assert.equal((await db.select().from(sessions).where(eq(sessions.userId, user.id))).length, kind === "password" ? 1 : 0);
  });
});
test("settings outages fail safely without exposing private database errors", async () => {
  const failing = new Proxy(db, { get() { throw new Error("private connection URL"); } });
  await assert.rejects(getSettingsProfile(failing, "A".repeat(43)));
  assert.deepEqual(await updateProfile(failing, "A".repeat(43), changes), { ok: false, reason: "unavailable" });
  assert.deepEqual(await updatePassword(failing, "A".repeat(43), { password: "secret" }), { ok: false, reason: "unavailable" });
  assert.deepEqual(await deactivateAccount(failing, "A".repeat(43)), { ok: false, reason: "unavailable" });
});

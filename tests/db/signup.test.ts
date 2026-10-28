import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import { sessions, users } from "../../db/schema";
import { registerUser } from "../../auth/signup";
import { hashPassword } from "../../auth/password";
import { findSessionUser } from "../../auth/session-store";
import type { AuthDatabase } from "../../auth/database";
import { signupFixture } from "./auth-helpers";

loadEnvConfig(process.cwd(), true);
const { pool, db } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
async function rollback(work: (tx: AuthDatabase) => Promise<void>) {
  const sentinel = new Error("rollback fixture");
  try {
    await db.transaction(async (tx) => {
      await work(tx);
      throw sentinel;
    });
  } catch (error) {
    if (error !== sentinel) throw error;
  }
}

for (const displayName of [null, "Countess"])
  test(`signup stores hash and initial session with display name ${displayName}`, async () => {
    await rollback(async (tx) => {
      const input = {
        ...signupFixture(),
        displayName,
        admin: true,
        emailConfirmed: true,
      };
      const result = await registerUser(tx, input, input.email);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.email, input.email));
      assert.equal(user.displayName, displayName);
      assert.equal(user.avatarUrl, null);
      assert.equal(user.active, true);
      assert.equal(user.admin, false);
      assert.equal(user.emailConfirmed, false);
      assert.equal(user.dateOfBirth, "1815-12-10");
      const parts = user.passwordHash.split("$");
      const key = scryptSync(
        input.password,
        Buffer.from(parts[4], "base64url"),
        64,
        { N: 32768, r: 8, p: 3, maxmem: 67108864 },
      );
      assert.equal(key.toString("base64url"), parts[5]);
      assert.equal(
        (await tx.select().from(sessions).where(eq(sessions.userId, user.id)))
          .length,
        1,
      );
      assert.deepEqual(await findSessionUser(tx, result.session.token), {
        userId: user.id,
        firstName: "Ada",
        lastName: "Lovelace",
        displayName,
        avatarFileId: null,
        admin: false,
      });
      assert.ok(!JSON.stringify(result).includes(user.passwordHash));
      assert.ok(!JSON.stringify(result).includes(input.password));
    });
  });

for (const active of [true, false])
  test(`duplicate email cannot change or sign in existing active=${active} account`, async () => {
    await rollback(async (tx) => {
      const input = signupFixture();
      const [original] = await tx
        .insert(users)
        .values({ ...input, passwordHash: "existing hash", active })
        .returning();
      assert.deepEqual(
        await registerUser(
          tx,
          { ...input, email: input.email.toUpperCase() },
          input.email,
        ),
        { ok: false, reason: "emailTaken" },
      );
      const [unchanged] = await tx
        .select()
        .from(users)
        .where(eq(users.id, original.id));
      assert.deepEqual(unchanged, original);
      assert.equal(
        (
          await tx
            .select()
            .from(sessions)
            .where(eq(sessions.userId, original.id))
        ).length,
        0,
      );
    });
  });

test("concurrent case-variant registrations create only one user and session", async () => {
  const input = signupFixture();
  try {
    const results = await Promise.all([
      registerUser(db, input, input.email),
      registerUser(
        db,
        { ...input, email: input.email.toUpperCase() },
        input.email,
      ),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.deepEqual(
      results.find((result) => !result.ok),
      { ok: false, reason: "emailTaken" },
    );
    const matching = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`);
    assert.equal(matching.length, 1);
    assert.equal(
      (
        await db
          .select()
          .from(sessions)
          .where(eq(sessions.userId, matching[0].id))
      ).length,
      1,
    );
  } finally {
    await db.delete(users).where(sql`lower(${users.email}) = ${input.email}`);
  }
});

test("failed session insertion rolls back the user and does not misclassify unrelated unique violations", async () => {
  const input = signupFixture();
  const failing = new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "transaction")
        return Reflect.get(target, property, receiver);
      return ((callback) =>
        target.transaction(async (tx) =>
          callback(
            new Proxy(tx, {
              get(transaction, key, proxy) {
                if (key !== "insert")
                  return Reflect.get(transaction, key, proxy);
                return ((table) => {
                  if (Object.is(table, sessions))
                    throw Object.assign(
                      new Error("private SQL/credentials must not escape"),
                      { code: "23505", constraint: "other_unique" },
                    );
                  return transaction.insert(table);
                }) as typeof tx.insert;
              },
            }),
          ),
        )) as typeof db.transaction;
    },
  });
  assert.deepEqual(await registerUser(failing, input, input.email), {
    ok: false,
    reason: "unavailable",
  });
  assert.equal(
    (await db.select().from(users).where(eq(users.email, input.email))).length,
    0,
  );
});

test("database failure and hash saturation safely reject without accounts", async () => {
  const input = signupFixture();
  const failedDb = new Proxy(db, {
    get(target, key, receiver) {
      if (key === "transaction")
        return () => {
          throw new Error("secret database URL");
        };
      return Reflect.get(target, key, receiver);
    },
  });
  assert.deepEqual(await registerUser(failedDb, input, input.email), {
    ok: false,
    reason: "unavailable",
  });
  const [, , result] = await Promise.all([
    hashPassword("one"),
    hashPassword("two"),
    registerUser(db, input, input.email),
  ]);
  assert.deepEqual(result, { ok: false, reason: "unavailable" });
  assert.equal(
    (await db.select().from(users).where(eq(users.email, input.email))).length,
    0,
  );
});

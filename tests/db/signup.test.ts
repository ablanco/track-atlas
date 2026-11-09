import { legalDocuments } from "../../legal/documents";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import {
  sessions,
  users,
  legalAcceptances,
  accountActionTokens,
} from "../../db/schema";
import { registerUser } from "../../auth/signup";
import { hashPassword } from "../../auth/password";
import { findSessionUser } from "../../auth/session-store";
import type { AuthTransaction } from "../../auth/database";
import {
  listLegalAcceptances,
  appendLegalAcceptance,
} from "../../legal/acceptance-store";
import { signupFixture } from "./auth-helpers";

loadEnvConfig(process.cwd(), true);
const { pool, db } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
async function rollback(work: (tx: AuthTransaction) => Promise<void>) {
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
      const evidence = await listLegalAcceptances(tx, user.id);
      assert.equal(evidence.length, 1);
      assert.equal(
        evidence[0].termsVersion,
        legalDocuments.terms.currentVersion,
      );
      assert.equal(
        evidence[0].privacyVersion,
        legalDocuments.privacy.currentVersion,
      );
      assert.equal(evidence[0].locale, "en");
      assert.ok(evidence[0].acceptedAt instanceof Date);
      assert.equal(
        evidence[0].acceptedAt.getTime(),
        evidence[0].createdAt.getTime(),
      );
      await appendLegalAcceptance(tx, user.id, {
        ...input.legalAcceptance,
        locale: "es",
      });
      const history = await listLegalAcceptances(tx, user.id);
      assert.equal(history.length, 2);
      assert.deepEqual(
        history.find((row) => row.id === evidence[0].id),
        evidence[0],
      );
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

for (const failedTable of [legalAcceptances, accountActionTokens, sessions])
  test(`failed registration insertion rolls back account and evidence (${failedTable === sessions ? "session" : failedTable === legalAcceptances ? "evidence" : "token"})`, async () => {
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
                    if (Object.is(table, failedTable))
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
      (await db.select().from(users).where(eq(users.email, input.email)))
        .length,
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

test("evidence rejects direct updates, keeps database timestamps and cascades with account deletion", async () => {
  await rollback(async (tx) => {
    const input = signupFixture();
    const result = await registerUser(tx, input, input.email);
    assert.equal(result.ok, true);
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.email, input.email));
    const [evidence] = await listLegalAcceptances(tx, user.id);
    await assert.rejects(
      tx.transaction(async (nested) => {
        await nested.execute(
          sql`UPDATE legal_acceptances SET locale = 'es' WHERE id = ${evidence.id}`,
        );
      }),
      (error: unknown) =>
        (error as { cause?: { code?: string } }).cause?.code === "23514",
    );
    assert.deepEqual(await listLegalAcceptances(tx, user.id), [evidence]);
    const triggers = await tx.execute(
      sql`SELECT tgname FROM pg_trigger WHERE tgrelid = 'legal_acceptances'::regclass AND NOT tgisinternal`,
    );
    assert.ok(
      triggers.rows.some(
        (row) => row.tgname === "legal_acceptances_set_updated_at",
      ),
    );
    await tx.delete(users).where(eq(users.id, user.id));
    assert.deepEqual(await listLegalAcceptances(tx, user.id), []);
  });
});

test("registration refuses absent or stale exact revisions without an account", async () => {
  for (const legalAcceptance of [
    undefined,
    { ...signupFixture().legalAcceptance, termsVersion: "old" },
    { ...signupFixture().legalAcceptance, privacyVersion: "old" },
  ]) {
    const input = { ...signupFixture(), legalAcceptance } as Parameters<
      typeof registerUser
    >[1];
    assert.deepEqual(await registerUser(db, input, input.email), {
      ok: false,
      reason: "unavailable",
    });
    assert.equal(
      (await db.select().from(users).where(eq(users.email, input.email)))
        .length,
      0,
    );
  }
});

test("legal rejection leaves proof unused; successful registration records evidence once and rejects proof replay", async () => {
  const { createChallenge, solveChallenge } = await import("altcha-lib");
  const { deriveKey } = await import("altcha-lib/algorithms/sha");
  const { verifySignupCaptcha } = await import("../../auth/captcha");
  const { handleSignup } = await import("../../auth/signup-action");
  const secret = "test-only-legal-signup-captcha-secret";
  const challenge = await createChallenge({
    algorithm: "SHA-256",
    cost: 1,
    counter: 3,
    deriveKey,
    expiresAt: new Date(Date.now() + 300_000),
    data: { purpose: "signup" },
    hmacSignatureSecret: secret,
  });
  const solution = await solveChallenge({ challenge, deriveKey });
  const payload = Buffer.from(JSON.stringify({ challenge, solution })).toString(
    "base64",
  );
  await rollback(async (tx) => {
    const input = {
      ...signupFixture(),
      password: "violet otter brass lantern",
    };
    const form = new FormData();
    for (const [key, value] of Object.entries(input))
      if (typeof value === "string") form.set(key, value);
    form.set("termsVersion", legalDocuments.terms.currentVersion);
    form.set("privacyVersion", legalDocuments.privacy.currentVersion);
    form.set("privacyAcknowledged", "on");
    form.set("altcha", payload);
    const redirected = new Error("redirect");
    const dependencies = {
      currentUser: async () => null,
      verifyCaptcha: (data: FormData) => verifySignupCaptcha(tx, data, secret),
      register: (values: Parameters<typeof registerUser>[1]) =>
        registerUser(tx, values, values.email),
      sendConfirmation: async () => {},
      setSession: async () => {},
      redirectHome: (): never => {
        throw redirected;
      },
    };
    const missing = await handleSignup("es", form, dependencies);
    assert.equal(missing.fieldErrors.termsAccepted, "required");
    form.set("termsAccepted", "on");
    const invalidProof = new FormData();
    for (const [key, value] of form) invalidProof.append(key, value);
    invalidProof.set("altcha", "malformed");
    assert.equal(
      (await handleSignup("es", invalidProof, dependencies)).formError,
      "captcha",
    );
    assert.equal(
      (await tx.select().from(users).where(eq(users.email, input.email)))
        .length,
      0,
    );
    await assert.rejects(
      handleSignup("es", form, dependencies),
      (error) => error === redirected,
    );
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.email, input.email));
    const evidence = await listLegalAcceptances(tx, user.id);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].locale, "es");
    form.set("email", signupFixture().email);
    assert.equal(
      (await handleSignup("es", form, dependencies)).formError,
      "captcha",
    );
    assert.deepEqual(await listLegalAcceptances(tx, user.id), evidence);
    assert.equal(
      (
        await tx
          .select()
          .from(users)
          .where(eq(users.email, String(form.get("email"))))
      ).length,
      0,
    );
  });
});

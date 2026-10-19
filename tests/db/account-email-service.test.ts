import assert from "node:assert/strict";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import {
  users,
  emailSendLimits,
  accountActionTokens,
  sessions,
} from "../../db/schema";
import {
  requestPasswordReset,
  requestEmailConfirmation,
} from "../../auth/account-email";
import { createSession } from "../../auth/session-store";
import { emailRateKey, getEmailRateKey } from "../../auth/email-rate-limit";
import { signupFixture } from "./auth-helpers";
import {
  issueAccountToken,
  inspectAccountToken,
} from "../../auth/account-token-store";
import { updatePassword, deactivateAccount } from "../../auth/settings";
import { resetAccountPassword } from "../../auth/password-recovery";
import { hashPassword } from "../../auth/password";
import { loginUser } from "../../auth/login";
import type { Database, AuthTransaction } from "../../auth/database";
loadEnvConfig(process.cwd(), true);
const { db, pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
process.env.EMAIL_DELIVERY_MODE = "capture";
process.env.EMAIL_RATE_LIMIT_SECRET =
  "test-private-email-service-rate-key-2026";
process.env.APP_ORIGIN = "http://localhost:3000";
async function withIsolatedLimits(
  work: (tx: AuthTransaction) => Promise<void>,
) {
  const rollback = Error("rollback email-service fixture");
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`CREATE TEMP TABLE email_send_limits (LIKE public.email_send_limits INCLUDING ALL) ON COMMIT DROP`,
      );
      await work(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
for (const local of ["İ", "ΟΣ"])
  test(`recovery follows login database identity for ${local}`, async () => {
    await withIsolatedLimits(async (tx) => {
      const email = `${local}-${randomUUID()}@example.test`;
      const [user] = await tx
        .insert(users)
        .values({ ...signupFixture(), email, passwordHash: "old" })
        .returning();
      const messages: string[] = [];
      await requestPasswordReset(tx, user.email, "en", async (message) => {
        messages.push(message.to.email);
        return { ok: true, messageId: "captured" };
      });
      assert.deepEqual(messages, [email]);
    });
  });
test("third confirmation request returns the remaining rolling-hour cooldown, even after provider failure", async () => {
  await withIsolatedLimits(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ ...signupFixture(), passwordHash: "old" })
      .returning();
    const session = await createSession(tx, user.id);
    const key = `address:email-confirmation:${emailRateKey(user.email, process.env.EMAIL_RATE_LIMIT_SECRET!)}`;
    for (const failure of [false, true]) {
      await tx
        .insert(emailSendLimits)
        .values({
          key,
          attemptedAt: sql`ARRAY[clock_timestamp()-interval '121 seconds',clock_timestamp()-interval '61 seconds']`,
        })
        .onConflictDoUpdate({
          target: emailSendLimits.key,
          set: {
            attemptedAt: sql`ARRAY[clock_timestamp()-interval '121 seconds',clock_timestamp()-interval '61 seconds']`,
          },
        });
      const result = await requestEmailConfirmation(
        tx,
        session.token,
        "en",
        async () =>
          failure
            ? { ok: false, reason: "unavailable" }
            : { ok: true, messageId: "captured" },
      );
      assert.ok(
        result.retryAfterSeconds! > 3400 && result.retryAfterSeconds! <= 3480,
      );
      assert.equal(result.ok, !failure);
      await tx
        .update(emailSendLimits)
        .set({ attemptedAt: [] })
        .where(eq(emailSendLimits.key, key));
    }
  });
});
test("confirmation response reflects cooldown elapsed during delivery", async () => {
  await withIsolatedLimits(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ ...signupFixture(), passwordHash: "old" })
      .returning();
    const session = await createSession(tx, user.id);
    const key = `address:email-confirmation:${await getEmailRateKey(tx, user.email, process.env.EMAIL_RATE_LIMIT_SECRET!)}`;
    const result = await requestEmailConfirmation(
      tx,
      session.token,
      "en",
      async () => {
        await tx
          .update(emailSendLimits)
          .set({
            attemptedAt: sql`ARRAY[clock_timestamp()-interval '61 seconds']`,
          })
          .where(eq(emailSendLimits.key, key));
        return { ok: true, messageId: "captured" };
      },
    );
    assert.deepEqual(result, { ok: true, retryAfterSeconds: 0 });
  });
});

// These gates pause only orchestration boundaries. Queries/locks/transactions,
// password hashing and account mutations still execute against separate real connections.
function gatedTransaction(phase: "before" | "before-commit", skip = 0) {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const instrumented = new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "transaction")
        return Reflect.get(target, property, receiver);
      return (async (work: Parameters<Database["transaction"]>[0]) => {
        if (skip-- > 0) return target.transaction(work);
        if (phase === "before") {
          entered.resolve();
          await release.promise;
          return target.transaction(work);
        }
        return target.transaction(async (tx) => {
          const result = await work(tx);
          entered.resolve();
          await release.promise;
          return result;
        });
      }) as typeof db.transaction;
    },
  });
  return {
    db: instrumented,
    entered: entered.promise,
    release: () => release.resolve(),
  };
}
for (const mutation of ["settings-password", "reset", "deactivate"] as const)
  for (const order of ["issuance-first", "mutation-first"] as const)
    test(`${mutation} versus reset issuance has no usable post-invalidation token (${order})`, async () => {
      const [user] = await db
        .insert(users)
        .values({
          ...signupFixture(),
          passwordHash: await hashPassword("old password"),
        })
        .returning();
      const key = await getEmailRateKey(
        db,
        user.email,
        process.env.EMAIL_RATE_LIMIT_SECRET!,
      );
      const issuedGate = gatedTransaction(
        order === "issuance-first" ? "before-commit" : "before",
        1,
      );
      try {
        const session = await createSession(db, user.id);
        const original = await db.transaction((tx) =>
          issueAccountToken(tx, user, "password-reset"),
        );
        const issuance = requestPasswordReset(
          issuedGate.db,
          user.email,
          "en",
          async () => ({ ok: true, messageId: "captured" }),
        );
        await issuedGate.entered;
        const mutate = (database: typeof db) =>
          mutation === "reset"
            ? resetAccountPassword(database, original.token, {
                password: "replacement",
              })
            : mutation === "deactivate"
              ? deactivateAccount(database, session.token)
              : updatePassword(database, session.token, {
                  password: "replacement",
                });
        let result;
        if (order === "mutation-first") {
          result = await mutate(db);
          issuedGate.release();
          await issuance;
        } else {
          const mutationGate = gatedTransaction("before");
          const pending = mutate(mutationGate.db);
          await mutationGate.entered;
          mutationGate.release();
          issuedGate.release();
          await issuance;
          result = await pending;
        }
        assert.equal(result.ok, true);
        const rows = await db
          .select()
          .from(accountActionTokens)
          .where(eq(accountActionTokens.userId, user.id));
        assert.equal(rows.length, order === "issuance-first" ? 2 : 1);
        assert.ok(
          rows.every(
            (row) => row.consumedAt !== null || row.revokedAt !== null,
          ),
        );
        assert.equal(
          await inspectAccountToken(db, "password-reset", original.token),
          "invalid",
        );
      } finally {
        issuedGate.release();
        await db.delete(users).where(eq(users.id, user.id));
        await db
          .delete(emailSendLimits)
          .where(eq(emailSendLimits.key, `address:password-reset:${key}`));
      }
    });
for (const order of ["login-first", "reset-first"] as const)
  test(`login versus reset cannot leave a stale credential session (${order})`, async () => {
    const [user] = await db
      .insert(users)
      .values({
        ...signupFixture(),
        passwordHash: await hashPassword("old password"),
      })
      .returning();
    const gate = gatedTransaction(
      order === "login-first" ? "before-commit" : "before",
    );
    try {
      const token = await db.transaction((tx) =>
        issueAccountToken(tx, user, "password-reset"),
      );
      const login = loginUser(gate.db, {
        email: user.email,
        password: "old password",
      });
      await gate.entered;
      if (order === "reset-first") {
        assert.equal(
          (
            await resetAccountPassword(db, token.token, {
              password: "replacement",
            })
          ).ok,
          true,
        );
        gate.release();
        assert.equal((await login).ok, false);
      } else {
        const resetGate = gatedTransaction("before");
        const resetting = resetAccountPassword(resetGate.db, token.token, {
          password: "replacement",
        });
        await resetGate.entered;
        resetGate.release();
        gate.release();
        assert.equal((await login).ok, true);
        assert.equal((await resetting).ok, true);
      }
      assert.equal(
        (await db.select().from(sessions).where(eq(sessions.userId, user.id)))
          .length,
        0,
      );
    } finally {
      gate.release();
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

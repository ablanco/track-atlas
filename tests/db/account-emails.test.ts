import assert from "node:assert/strict";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import {
  accountActionTokens,
  emailSendLimits,
  users,
  sessions,
} from "../../db/schema";
import { signupFixture } from "./auth-helpers";
import {
  issueAccountToken,
  inspectAccountToken,
} from "../../auth/account-token-store";
import { confirmAccountEmail } from "../../auth/account-confirmation";
import { resetAccountPassword } from "../../auth/password-recovery";
import { createSession, findSessionUser } from "../../auth/session-store";
import { updatePassword, deactivateAccount } from "../../auth/settings";
import type { Database } from "../../auth/database";
import {
  reserveEmailRequest,
  reserveEmailDailyBudget,
  readEmailCooldown,
} from "../../auth/email-rate-limit";
loadEnvConfig(process.cwd(), true);
const { db, pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
async function tokenFixture(
  work: (
    user: typeof users.$inferSelect,
    confirmation: string,
    reset: string,
  ) => Promise<void>,
) {
  const [user] = await db
    .insert(users)
    .values({ ...signupFixture(), passwordHash: "old" })
    .returning();
  try {
    const [confirmation, reset] = await db.transaction(async (tx) => [
      await issueAccountToken(tx, user, "email-confirmation"),
      await issueAccountToken(tx, user, "password-reset"),
    ]);
    await work(user, confirmation.token, reset.token);
  } finally {
    await db.delete(users).where(eq(users.id, user.id));
  }
}
test("confirmation inspection never consumes; purpose and replay are enforced", async () => {
  await tokenFixture(async (user, confirmation, reset) => {
    assert.equal(
      await inspectAccountToken(db, "email-confirmation", confirmation),
      "valid",
    );
    assert.equal(
      await inspectAccountToken(db, "email-confirmation", confirmation),
      "valid",
    );
    assert.equal(
      await inspectAccountToken(db, "email-confirmation", reset),
      "invalid",
    );
    const results = await Promise.all([
      confirmAccountEmail(db, confirmation),
      confirmAccountEmail(db, confirmation),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(
      await inspectAccountToken(db, "email-confirmation", confirmation),
      "invalid",
    );
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    assert.equal(row.emailConfirmed, true);
  });
});
test("reset revokes every session and outstanding reset link but does not confirm email", async () => {
  await tokenFixture(async (user, confirmation, reset) => {
    const first = await createSession(db, user.id),
      second = await createSession(db, user.id);
    const extra = await db.transaction((tx) =>
      issueAccountToken(tx, user, "password-reset"),
    );
    assert.equal(
      await inspectAccountToken(db, "password-reset", reset),
      "valid",
    );
    assert.equal(
      await inspectAccountToken(db, "password-reset", extra.token),
      "valid",
    );
    assert.deepEqual(
      await resetAccountPassword(db, reset, { password: " replacement " }),
      { ok: true },
    );
    assert.equal(await findSessionUser(db, first.token), null);
    assert.equal(await findSessionUser(db, second.token), null);
    assert.equal(
      await inspectAccountToken(db, "password-reset", extra.token),
      "invalid",
    );
    assert.equal(
      await inspectAccountToken(db, "email-confirmation", confirmation),
      "valid",
    );
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    assert.equal(row.emailConfirmed, false);
    assert.notEqual(row.passwordHash, "old");
    assert.equal(
      (await db.select().from(sessions).where(eq(sessions.userId, user.id)))
        .length,
      0,
    );
  });
});
test("settings password changes and deactivation invalidate outstanding account links", async () => {
  await tokenFixture(async (user, confirmation, reset) => {
    const session = await createSession(db, user.id);
    assert.deepEqual(
      await updatePassword(db, session.token, { password: "changed" }),
      { ok: true },
    );
    assert.equal(
      await inspectAccountToken(db, "password-reset", reset),
      "invalid",
    );
    assert.equal(
      await inspectAccountToken(db, "email-confirmation", confirmation),
      "valid",
    );
    assert.deepEqual(await deactivateAccount(db, session.token), { ok: true });
    assert.equal(
      await inspectAccountToken(db, "email-confirmation", confirmation),
      "invalid",
    );
    assert.equal((await confirmAccountEmail(db, confirmation)).ok, false);
  });
});
test("expired links fail without mutation and token audit timestamps are automatic", async () => {
  await tokenFixture(async (user, confirmation, reset) => {
    const rows = await db
      .select()
      .from(accountActionTokens)
      .where(eq(accountActionTokens.userId, user.id));
    assert.ok(
      rows.every(
        (r) =>
          r.createdAt &&
          r.updatedAt &&
          r.tokenHash !== confirmation &&
          r.tokenHash !== reset,
      ),
    );
    assert.ok(
      Math.abs(
        rows.find((r) => r.purpose === "password-reset")!.expiresAt.getTime() -
          rows[0].createdAt.getTime() -
          3600000,
      ) < 1000,
    );
    await db
      .update(accountActionTokens)
      .set({ expiresAt: new Date(0), updatedAt: new Date(0) })
      .where(eq(accountActionTokens.userId, user.id));
    const [row] = await db
      .select()
      .from(accountActionTokens)
      .where(eq(accountActionTokens.userId, user.id));
    assert.ok(row.updatedAt.getTime() > 0);
    assert.equal(
      (await resetAccountPassword(db, reset, { password: "changed" })).ok,
      false,
    );
    assert.equal((await confirmAccountEmail(db, confirmation)).ok, false);
  });
});
test("expiry and deactivation are rechecked after reset preflight", async () => {
  for (const kind of ["expire", "disable"] as const)
    await tokenFixture(async (user, _confirmation, reset) => {
      const instrumented = new Proxy(db, {
        get(target, property, receiver) {
          if (property !== "transaction")
            return Reflect.get(target, property, receiver);
          return (async (work: Parameters<Database["transaction"]>[0]) => {
            if (kind === "expire")
              await db
                .update(accountActionTokens)
                .set({ expiresAt: new Date(0) })
                .where(eq(accountActionTokens.userId, user.id));
            else
              await db
                .update(users)
                .set({ active: false })
                .where(eq(users.id, user.id));
            return target.transaction(work);
          }) as typeof db.transaction;
        },
      });
      assert.deepEqual(
        await resetAccountPassword(instrumented, reset, {
          password: "replacement",
        }),
        { ok: false, reason: "invalid" },
      );
      assert.equal(
        (await db.select().from(users).where(eq(users.id, user.id)))[0]
          .passwordHash,
        "old",
      );
      assert.ok(
        (
          await db
            .select()
            .from(accountActionTokens)
            .where(eq(accountActionTokens.userId, user.id))
        ).every((row) => row.consumedAt === null),
      );
    });
});
test("failed password update rolls back token consumption and all session revocation", async () => {
  await tokenFixture(async (user, _confirmation, reset) => {
    const session = await createSession(db, user.id);
    const failing = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "transaction")
          return Reflect.get(target, property, receiver);
        return ((work: Parameters<Database["transaction"]>[0]) =>
          target.transaction((tx) =>
            work(
              new Proxy(tx, {
                get(transaction, key, proxy) {
                  if (key !== "update")
                    return Reflect.get(transaction, key, proxy);
                  return ((table) => {
                    if (Object.is(table, users))
                      throw Error("private SQL failure");
                    return transaction.update(table);
                  }) as typeof tx.update;
                },
              }),
            ),
          )) as typeof db.transaction;
      },
    });
    assert.deepEqual(
      await resetAccountPassword(failing, reset, { password: "replacement" }),
      { ok: false, reason: "unavailable" },
    );
    assert.equal(
      await inspectAccountToken(db, "password-reset", reset),
      "valid",
    );
    assert.ok(await findSessionUser(db, session.token));
  });
});
test("concurrent reset consumers have a single winner", async () => {
  await tokenFixture(async (_user, _confirmation, reset) => {
    const results = await Promise.all([
      resetAccountPassword(db, reset, { password: "one" }),
      resetAccountPassword(db, reset, { password: "two" }),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
  });
});
test("email limits enforce cooldown and rolling hour in independent purpose buckets", async () => {
  const key = randomUUID();
  try {
    assert.deepEqual(await reserveEmailRequest(db, "password-reset", key), {
      allowed: true,
    });
    assert.equal(
      (await reserveEmailRequest(db, "password-reset", key)).allowed,
      false,
    );
    assert.ok((await readEmailCooldown(db, "password-reset", key)) > 0);
    assert.equal(
      (await reserveEmailRequest(db, "email-confirmation", key)).allowed,
      true,
    );
    const bucket = `address:password-reset:${key}`;
    await db
      .update(emailSendLimits)
      .set({
        attemptedAt: sql`ARRAY[clock_timestamp()-interval '121 seconds',clock_timestamp()-interval '61 seconds']`,
      })
      .where(eq(emailSendLimits.key, bucket));
    assert.equal(
      (await reserveEmailRequest(db, "password-reset", key)).allowed,
      true,
    );
    await db
      .update(emailSendLimits)
      .set({
        attemptedAt: sql`ARRAY[clock_timestamp()-interval '181 seconds',clock_timestamp()-interval '121 seconds',clock_timestamp()-interval '61 seconds']`,
      })
      .where(eq(emailSendLimits.key, bucket));
    const denied = await reserveEmailRequest(db, "password-reset", key);
    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.ok(denied.retryAfterSeconds > 3000);
    await db
      .update(emailSendLimits)
      .set({ attemptedAt: sql`ARRAY[clock_timestamp()-interval '1 hour']` })
      .where(eq(emailSendLimits.key, bucket));
    assert.equal(
      (await reserveEmailRequest(db, "password-reset", key)).allowed,
      true,
    );
  } finally {
    await db
      .delete(emailSendLimits)
      .where(
        sql`${emailSendLimits.key} IN (${`address:password-reset:${key}`}, ${`address:email-confirmation:${key}`})`,
      );
  }
});
test("concurrent email requests have only one cooldown winner", async () => {
  const key = randomUUID();
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        reserveEmailRequest(db, "password-reset", key),
      ),
    );
    assert.equal(results.filter((r) => r.allowed).length, 1);
  } finally {
    await db
      .delete(emailSendLimits)
      .where(eq(emailSendLimits.key, `address:password-reset:${key}`));
  }
});
test("daily quota admits 250 attempts and does not affect the application's bucket", async () => {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`CREATE TEMP TABLE email_send_limits (LIKE public.email_send_limits INCLUDING ALL) ON COMMIT DROP`,
    );
    for (let i = 0; i < 250; i++)
      assert.equal(await reserveEmailDailyBudget(tx), true);
    assert.equal(await reserveEmailDailyBudget(tx), false);
  });
});

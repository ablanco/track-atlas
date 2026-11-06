import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createChallenge, solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/sha";
import { createDatabase } from "../../db/client";
import { pruneDatabase } from "../../db/prune";
import {
  reserveEmailRequest,
  reserveEmailDailyBudget,
} from "../../auth/email-rate-limit";
import { reserveDiscussionEmailBudget } from "../../email/discussion-budget";
import { verifySignupCaptcha } from "../../auth/captcha";

loadEnvConfig(process.cwd(), true);
const url = new URL(process.env.DATABASE_URL!);
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
  "Pruning tests require a loopback development database",
);
const control = createDatabase(url.href);
after(() => control.pool.end());

async function fixture(
  work: (
    instance: ReturnType<typeof createDatabase>,
    schema: string,
    app: string,
  ) => Promise<void>,
) {
  const suffix = randomUUID().replaceAll("-", "");
  const schema = `prune_${suffix}`;
  const app = `prune-${suffix}`;
  await control.pool.query(`CREATE SCHEMA ${schema}`);
  let instance: ReturnType<typeof createDatabase> | undefined;
  try {
    for (const table of [
      "sessions",
      "account_action_tokens",
      "captcha_uses",
      "email_send_limits",
    ])
      await control.pool.query(
        `CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`,
      );
    await control.pool.query(
      `CREATE TABLE ${schema}.test_clock (value timestamptz NOT NULL)`,
    );
    await control.pool.query(
      `INSERT INTO ${schema}.test_clock VALUES ('2026-01-02T12:00:00Z')`,
    );
    await control.pool.query(
      `CREATE FUNCTION ${schema}.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE AS 'SELECT value FROM ${schema}.test_clock'`,
    );
    const connection = new URL(url.href);
    connection.searchParams.set(
      "options",
      `-csearch_path=${schema},pg_catalog,public`,
    );
    connection.searchParams.set("application_name", app);
    instance = createDatabase(connection.href);
    await work(instance, schema, app);
  } finally {
    await instance?.pool.end();
    await control.pool.query(`DROP SCHEMA ${schema} CASCADE`);
  }
}

async function waitForLock(app: string) {
  for (let i = 0; i < 200; i++) {
    const result = await control.pool.query(
      "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND state='active' AND wait_event_type='Lock'",
      [app],
    );
    if (result.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error("Expected database lock wait");
}

test("prunes only unusable records, preserves active protection windows and is repeatable", async () => {
  await fixture(async ({ db, pool }) => {
    await pool.query(`INSERT INTO sessions(user_id, token_hash, expires_at) VALUES
      (gen_random_uuid(), 'expired', clock_timestamp()),
      (gen_random_uuid(), 'active', clock_timestamp() + interval '1 day')`);
    await pool.query(`INSERT INTO account_action_tokens(user_id, purpose, token_hash, expires_at, consumed_at, revoked_at) VALUES
      (gen_random_uuid(), 'password-reset', 'expired', clock_timestamp(), NULL, NULL),
      (gen_random_uuid(), 'password-reset', 'consumed', clock_timestamp()+interval '1 day', clock_timestamp(), NULL),
      (gen_random_uuid(), 'email-confirmation', 'revoked', clock_timestamp()+interval '1 day', NULL, clock_timestamp()),
      (gen_random_uuid(), 'email-confirmation', 'active', clock_timestamp()+interval '1 day', NULL, NULL)`);
    await pool.query(`INSERT INTO captcha_uses(challenge_hash, expires_at) VALUES
      ('expired', clock_timestamp()), ('active', clock_timestamp()+interval '1 minute')`);
    await pool.query(`INSERT INTO email_send_limits(key, attempted_at, updated_at) VALUES
      ('address:password-reset:expired', ARRAY[clock_timestamp()-interval '1 hour'], clock_timestamp()),
      ('address:password-reset:active', ARRAY[clock_timestamp()-interval '59 minutes'], clock_timestamp()),
      ('daily:2026-01-01', ARRAY[clock_timestamp()-interval '1 day'], clock_timestamp()-interval '1 day'),
      ('discussion:daily:2026-01-01', ARRAY[clock_timestamp()-interval '1 day'], clock_timestamp()-interval '1 day'),
      ('daily:2026-01-02', ARRAY[clock_timestamp()], clock_timestamp()),
      ('discussion:daily:2026-01-02', ARRAY[clock_timestamp()], clock_timestamp()),
      ('other:retained', '{}', clock_timestamp()-interval '1 day')`);
    assert.deepEqual(await pruneDatabase(db), {
      sessions: 1,
      accountTokens: 3,
      captchaProofs: 1,
      emailLimits: 3,
    });
    assert.deepEqual(
      (await pool.query("SELECT token_hash FROM sessions")).rows,
      [{ token_hash: "active" }],
    );
    assert.deepEqual(
      (await pool.query("SELECT token_hash FROM account_action_tokens")).rows,
      [{ token_hash: "active" }],
    );
    assert.deepEqual(
      (await pool.query("SELECT challenge_hash FROM captcha_uses")).rows,
      [{ challenge_hash: "active" }],
    );
    assert.deepEqual(
      (
        await pool.query("SELECT key FROM email_send_limits ORDER BY key")
      ).rows.map((r) => r.key),
      [
        "address:password-reset:active",
        "daily:2026-01-02",
        "discussion:daily:2026-01-02",
        "other:retained",
      ],
    );
    assert.deepEqual(await pruneDatabase(db), {
      sessions: 0,
      accountTokens: 0,
      captchaProofs: 0,
      emailLimits: 0,
    });
  });
});

test("bounds batches and concurrent pruning drains a backlog", async () => {
  await fixture(async ({ db, pool }) => {
    await pool.query(
      `INSERT INTO captcha_uses(challenge_hash, expires_at) SELECT n::text, clock_timestamp() FROM generate_series(1,2501) n`,
    );
    assert.equal((await pruneDatabase(db)).captchaProofs, 1000);
    const results = await Promise.all([pruneDatabase(db), pruneDatabase(db)]);
    assert.equal(
      results.reduce((n, r) => n + r.captchaProofs, 0),
      1501,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int AS count FROM captcha_uses"))
        .rows[0].count,
      0,
    );
  });
});

test("skips locked records without interrupting account transactions", async () => {
  await fixture(async ({ db, pool }, schema) => {
    await pool.query(
      `INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(gen_random_uuid(),'locked',clock_timestamp())`,
    );
    const blocker = await control.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT * FROM ${schema}.sessions FOR UPDATE`);
      assert.equal((await pruneDatabase(db)).sessions, 0);
      await blocker.query("COMMIT");
      assert.equal((await pruneDatabase(db)).sessions, 1);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
});

test("waits for an in-flight email writer and preserves its refreshed allowance", async () => {
  await fixture(async ({ db, pool }, schema, app) => {
    const key = "address:password-reset:writer";
    await pool.query(
      `INSERT INTO email_send_limits(key,attempted_at) VALUES($1, ARRAY[clock_timestamp()-interval '2 hours'])`,
      [key],
    );
    const writer = await control.pool.connect();
    let pruning: ReturnType<typeof pruneDatabase> | undefined;
    try {
      await writer.query("BEGIN");
      await writer.query(
        `INSERT INTO ${schema}.email_send_limits(key) VALUES($1) ON CONFLICT DO NOTHING`,
        [key],
      );
      pruning = pruneDatabase(db);
      await waitForLock(app);
      await writer.query(
        `UPDATE ${schema}.email_send_limits SET attempted_at=ARRAY['2026-01-02T12:00:00Z'::timestamptz] WHERE key=$1`,
        [key],
      );
      await writer.query("COMMIT");
      assert.equal((await pruning).emailLimits, 0);
      assert.equal(
        (await reserveEmailRequest(db, "password-reset", "writer")).allowed,
        false,
      );
      assert.equal(await reserveEmailDailyBudget(db), true);
      await pool.query(
        "UPDATE email_send_limits SET attempted_at=array_fill(clock_timestamp(), ARRAY[250]) WHERE key='daily:2026-01-02'",
      );
      assert.equal(await reserveDiscussionEmailBudget(db, 1), true);
      await pruneDatabase(db);
      assert.equal(await reserveEmailDailyBudget(db), false);
      assert.equal(await reserveDiscussionEmailBudget(db, 1), false);
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
      await pruning;
    }
  });
});

test("CAPTCHA expiration after verification and during an insert wait cannot authorize a replay", async () => {
  await fixture(async ({ db, pool }, schema, app) => {
    const secret = randomBytes(32).toString("hex");
    const challenge = await createChallenge({
      algorithm: "SHA-256",
      cost: 1,
      counter: 3,
      deriveKey,
      expiresAt: new Date(Date.now() + 300000),
      data: { purpose: "signup" },
      hmacSignatureSecret: secret,
    });
    const solution = await solveChallenge({ challenge, deriveKey });
    assert.ok(solution);
    const form = new FormData();
    form.set(
      "altcha",
      Buffer.from(JSON.stringify({ challenge, solution })).toString("base64"),
    );
    await pool.query("UPDATE test_clock SET value=now()");
    assert.equal(await verifySignupCaptcha(db, form, secret), true);
    const blocker = await control.pool.connect();
    let replay: Promise<boolean> | undefined;
    try {
      await blocker.query("BEGIN");
      // Hold the same row deletion performed by pruning uncommitted, so the
      // already-verified replay waits on the unique index before inserting.
      await blocker.query(`UPDATE ${schema}.test_clock SET value='2100-01-01'`);
      await blocker.query(
        `DELETE FROM ${schema}.captcha_uses WHERE expires_at <= ${schema}.clock_timestamp()`,
      );
      replay = verifySignupCaptcha(db, form, secret);
      await waitForLock(app);
      await blocker.query("COMMIT");
      assert.equal(await replay, false);
      assert.equal((await pruneDatabase(db)).captchaProofs, 1);
      assert.equal(await verifySignupCaptcha(db, form, secret), false);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await replay;
    }
  });
});

for (const kind of ["account", "discussion"] as const)
  test(`${kind} daily budget chooses its UTC day after waiting for pruning`, async () => {
    await fixture(async ({ db, pool }, schema, app) => {
      await pool.query("UPDATE test_clock SET value='2026-01-02T23:59:59Z'");
      const cleaner = await control.pool.connect();
      let sending: Promise<boolean> | undefined;
      try {
        await cleaner.query("BEGIN");
        await cleaner.query(
          `LOCK TABLE ${schema}.email_send_limits IN SHARE ROW EXCLUSIVE MODE`,
        );
        sending =
          kind === "account"
            ? reserveEmailDailyBudget(db)
            : reserveDiscussionEmailBudget(db, 1);
        await waitForLock(app);
        await pool.query("UPDATE test_clock SET value='2026-01-03T00:00:00Z'");
        await cleaner.query("COMMIT");
        assert.equal(await sending, true);
        assert.deepEqual(
          (await pool.query("SELECT key FROM email_send_limits")).rows,
          [
            {
              key:
                kind === "account"
                  ? "daily:2026-01-03"
                  : "discussion:daily:2026-01-03",
            },
          ],
        );
      } finally {
        await cleaner.query("ROLLBACK");
        cleaner.release();
        await sending;
      }
    });
  });

test("lock timeout fails safely and earlier committed batches can be retried", async () => {
  await fixture(async ({ db, pool }, schema) => {
    await pool.query(
      `INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(gen_random_uuid(),'expired',clock_timestamp())`,
    );
    await pool.query(
      `INSERT INTO email_send_limits(key,attempted_at) VALUES('address:password-reset:expired', '{}')`,
    );
    const writer = await control.pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query(
        `LOCK TABLE ${schema}.email_send_limits IN ROW EXCLUSIVE MODE`,
      );
      await assert.rejects(pruneDatabase(db), (error: unknown) => {
        const cause = (error as { cause?: { code?: string } }).cause;
        return cause?.code === "55P03";
      });
      assert.equal(
        (await pool.query("SELECT count(*)::int AS count FROM sessions"))
          .rows[0].count,
        0,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM email_send_limits",
          )
        ).rows[0].count,
        1,
      );
      await writer.query("COMMIT");
      assert.equal((await pruneDatabase(db)).emailLimits, 1);
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
  });
});

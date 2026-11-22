import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../../db/client";
import { processDigests } from "../../digests/processor";
import type { EmailMessage, SendEmail } from "../../email/types";
loadEnvConfig(process.cwd(), true);
const url = new URL(process.env.DATABASE_URL!);
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    url.pathname === "/track_atlas_digest_75",
);
const control = createDatabase(url.href);
after(() => control.pool.end());
async function fixture(
  work: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const f = await setup();
  try {
    await work(f);
  } finally {
    await f.pool.end();
    await control.pool.query(`DROP SCHEMA ${f.schema} CASCADE`);
  }
}
async function setup() {
  const schema = "digest_" + randomUUID().replaceAll("-", "");
  await control.pool.query(`CREATE SCHEMA ${schema}`);
  for (const table of [
    "users",
    "tracks",
    "stored_files",
    "uploader_follows",
    "digest_deliveries",
    "digest_dispatch_days",
    "digest_scheduler_progress",
    "digest_opt_out_tokens",
    "email_send_limits",
  ])
    await control.pool.query(
      `CREATE TABLE ${schema}.${table}(LIKE public.${table} INCLUDING ALL)`,
    );
  await control.pool.query(
    `CREATE TABLE ${schema}.test_clock(value timestamptz);INSERT INTO ${schema}.test_clock VALUES('2026-11-22T12:00Z');CREATE FUNCTION ${schema}.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE AS 'SELECT value FROM ${schema}.test_clock'`,
  );
  const connection = new URL(url);
  connection.searchParams.set(
    "options",
    `-csearch_path=${schema},pg_catalog,public`,
  );
  const { db, pool } = createDatabase(connection.href);
  const u = (
    await pool.query(
      `INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth,email_confirmed) VALUES('Follower','Person','f@example.test','synthetic','1990-01-01',true),('Uploader','Person','u@example.test','synthetic','1990-01-01',true) RETURNING id`,
    )
  ).rows;
  const recipient = u[0].id as string,
    uploader = u[1].id as string;
  await pool.query(`INSERT INTO digest_scheduler_progress(id) VALUES(1)`);
  await pool.query(
    `INSERT INTO uploader_follows(follower_id,uploader_id,followed_at) VALUES($1,$2,'2026-11-20Z')`,
    [recipient, uploader],
  );
  async function publish(at = "2026-11-21T10:00Z", visibility = "public") {
    const file = randomUUID(),
      id = randomUUID();
    await pool.query(
      `INSERT INTO stored_files(id,owner_id,purpose,storage_location,object_key,status,byte_size,sha256,content_type) VALUES($1,$2,'gpx',$3,$4,'ready',10,$3,'application/gpx+xml')`,
      [file, uploader, "b".repeat(64), file],
    );
    await pool.query(
      `INSERT INTO tracks(id,owner_id,original_file_id,request_id,name,description,activity,difficulty,visibility,point_count,distance_meters,elevation_sample_count,version,digest_published_at) VALUES($1,$2,$3,$4,'Ridge','private description','hiking',3,$5,2,1234,0,2,$6)`,
      [id, uploader, file, randomUUID(), visibility, at],
    );
    return id;
  }
  const messages: EmailMessage[] = [];
  const send: SendEmail = async (m) => {
    messages.push(m);
    return { ok: true, messageId: "capture" };
  };
  const run = (transport: SendEmail = send, dailyLimit = 250) =>
    processDigests({
      db,
      send: transport,
      origin: "https://atlas.test",
      dailyLimit,
    });
  return { schema, db, pool, recipient, uploader, publish, messages, run };
}
test("public scheduler consolidates closed days and concurrent/repeated invocations dispatch once", async () =>
  fixture(async (f) => {
    const a = await f.publish(),
      b = await f.publish("2026-11-21T23:59:59.999999Z");
    await f.publish("2026-11-22T00:00Z");
    await Promise.all([f.run(), f.run(), f.run()]);
    await f.run();
    assert.equal(f.messages.length, 1);
    assert.ok(f.messages[0].text.includes(a));
    assert.ok(f.messages[0].text.includes(b));
    assert.ok(!f.messages[0].text.includes("private description"));
  }));
test("zero/exhausted budget defers durable work and separate allowance resumes without loss", async () =>
  fixture(async (f) => {
    await f.publish();
    assert.equal((await f.run(undefined, 0)).budgetExhausted, 1);
    assert.equal(f.messages.length, 0);
    await f.pool.query(
      `INSERT INTO email_send_limits(key,attempted_at) VALUES('daily:2026-11-22',ARRAY[clock_timestamp()]),('discussion:daily:2026-11-22',ARRAY[clock_timestamp()])`,
    );
    assert.equal((await f.run(undefined, 1)).accepted, 1);
    assert.equal(f.messages.length, 1);
    await f.pool.query(`UPDATE test_clock SET value='2026-11-23T12:00Z'`);
    await f.publish("2026-11-22T12:00Z");
    await f.run(undefined, 0);
    assert.equal(f.messages.length, 1);
    await f.run(undefined, 1);
    assert.equal(f.messages.length, 2);
  }));
test("only confirmed transient nonacceptance retries at 15/60 minutes; third rejection closes", async () =>
  fixture(async (f) => {
    await f.publish();
    let attempts = 0;
    const rejected: SendEmail = async () => {
      attempts++;
      return {
        ok: false,
        reason: "unavailable",
        delivery: "rejected",
        retryable: true,
      };
    };
    await f.run(rejected);
    await f.run(rejected);
    assert.equal(attempts, 1);
    await f.pool.query(
      `UPDATE test_clock SET value=value+interval '15 minutes'`,
    );
    await f.run(rejected);
    await f.run(rejected);
    assert.equal(attempts, 2);
    await f.pool.query(
      `UPDATE test_clock SET value=value+interval '60 minutes'`,
    );
    await f.run(rejected);
    await f.run(rejected);
    assert.equal(attempts, 3);
    assert.equal(
      (await f.pool.query(`SELECT state FROM digest_deliveries`)).rows[0].state,
      "failed",
    );
  }));
test("generic failures and exceptions are uncertain and never automatically retried", async () =>
  fixture(async (f) => {
    await f.publish();
    let calls = 0;
    await f.run(async () => {
      calls++;
      throw Error("private provider failure");
    });
    await f.run();
    assert.equal(calls, 1);
    assert.equal(f.messages.length, 0);
    assert.equal(
      (await f.pool.query(`SELECT state FROM digest_deliveries`)).rows[0].state,
      "uncertain",
    );
  }));
test("unconfirmed history defers, catches up seven days in one message, and reports expiration", async () =>
  fixture(async (f) => {
    await f.pool.query(`UPDATE users SET email_confirmed=false WHERE id=$1`, [
      f.recipient,
    ]);
    await f.publish();
    assert.equal((await f.run()).deferred, 1);
    await f.pool.query(
      `UPDATE test_clock SET value='2026-11-30T12:00Z'; UPDATE users SET email_confirmed=true`,
    );
    const latest = await f.publish("2026-11-29Z");
    const result = await f.run();
    assert.equal(result.expiredWindows, 1);
    assert.equal(f.messages.length, 1);
    assert.ok(f.messages[0].text.includes(latest));
    assert.ok(!f.messages[0].text.includes("2 new"));
  }));
test("current public access, follow generation and resume boundary filter every final snapshot", async () =>
  fixture(async (f) => {
    const visible = await f.publish(),
      privateId = await f.publish("2026-11-21Z", "private");
    const future = await f.publish("2026-11-22Z");
    await f.publish("2026-11-19Z");
    await f.publish(null as unknown as string);
    await f.pool.query(`UPDATE uploader_follows SET followed_at='2026-11-21Z'`);
    await f.run();
    const message = f.messages[0].text;
    assert.ok(message.includes(visible));
    assert.ok(!message.includes(privateId));
    assert.ok(!message.includes(future));
  }));
test("stale sending is terminal uncertainty and accepted-but-unpersisted result is never resent", async () =>
  fixture(async (f) => {
    await f.publish();
    await f.pool.query(
      `CREATE FUNCTION fail_finalize() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.state='sent' THEN RAISE EXCEPTION 'injected persistence failure'; END IF; RETURN NEW; END$$;CREATE TRIGGER fail_finalize BEFORE UPDATE ON digest_deliveries FOR EACH ROW EXECUTE FUNCTION fail_finalize()`,
    );
    await assert.rejects(f.run());
    assert.equal(f.messages.length, 1);
    await f.pool.query(
      `DROP TRIGGER fail_finalize ON digest_deliveries;UPDATE test_clock SET value=value+interval '11 minutes'`,
    );
    assert.equal((await f.run()).uncertain, 1);
    await f.run();
    assert.equal(f.messages.length, 1);
  }));
test("dispatch crossing midnight fences the actual day and prevents another message that day", async () =>
  fixture(async (f) => {
    await f.publish();
    await f.run(async (m) => {
      f.messages.push(m);
      await f.pool.query(`UPDATE test_clock SET value='2026-11-23T00:00:01Z'`);
      return { ok: true, messageId: "accepted" };
    });
    await f.publish("2026-11-22T18:00Z");
    await f.run();
    assert.equal(f.messages.length, 1);
  }));
test("opt-out GET never mutates; same-origin POST consumes once and disables only digest", async () =>
  fixture(async (f) => {
    const { handleDigestOptOut } = await import("../../digests/opt-out-http");
    await f.publish();
    await f.run();
    const link = f.messages[0].text.match(
      /https:\/\/atlas.test\/en\/digest-opt-out\?token=[\w-]+/,
    )![0];
    const deps = {
      db: f.db,
      origin: "https://atlas.test",
      locale: "en" as const,
    };
    const get = await handleDigestOptOut(new Request(link), deps);
    assert.equal(get.status, 200);
    assert.match(await get.text(), /<form/);
    assert.equal(
      (
        await f.pool.query(
          `SELECT digest_emails_enabled FROM users WHERE id=$1`,
          [f.recipient],
        )
      ).rows[0].digest_emails_enabled,
      true,
    );
    const post = (origin = "https://atlas.test") =>
      handleDigestOptOut(
        new Request("https://atlas.test/en/digest-opt-out", {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            token: new URL(link).searchParams.get("token")!,
          }),
        }),
        deps,
      );
    assert.equal((await post("https://evil.test")).status, 403);
    const done = await post();
    assert.equal(done.status, 200);
    assert.match(await done.text(), /Digest emails stopped/);
    assert.equal(done.headers.get("referrer-policy"), "no-referrer");
    assert.match(done.headers.get("cache-control")!, /no-store/);
    assert.match(
      await (await post()).text(),
      /invalid, expired or already used/,
    );
    const u = (
      await f.pool.query(
        `SELECT digest_emails_enabled,discussion_emails_enabled FROM users WHERE id=$1`,
        [f.recipient],
      )
    ).rows[0];
    assert.equal(u.digest_emails_enabled, false);
    assert.equal(u.discussion_emails_enabled, true);
    assert.equal(
      (await f.pool.query(`SELECT count(*) FROM uploader_follows`)).rows[0]
        .count,
      "1",
    );
  }));
test("history pruning preserves unresolved work, current-day fences and durable closed cursors", async () =>
  fixture(async (f) => {
    const { pruneDatabase } = await import("../../db/prune");
    for (const table of ["sessions", "account_action_tokens", "captcha_uses"])
      await f.pool.query(
        `CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`,
      );
    await f.publish();
    await f.run();
    await f.pool.query(
      `UPDATE digest_deliveries SET updated_at='2026-01-01Z';UPDATE test_clock SET value='2027-03-01T12:00Z'`,
    );
    const result = await pruneDatabase(f.db);
    assert.equal(result.digestDeliveries, 1);
    assert.equal(result.digestTokens, 1);
    await f.run();
    assert.equal(f.messages.length, 1);
  }));
for (const mutation of [
  `DELETE FROM uploader_follows`,
  `UPDATE uploader_follows SET followed_at='2026-11-22Z'`,
  `UPDATE users SET digest_emails_enabled=false`,
  `UPDATE users SET digest_resume_after='2026-11-22Z'`,
  `UPDATE users SET active=false`,
  `UPDATE tracks SET visibility='private'`,
  `DELETE FROM stored_files`,
])
  test(`final read suppresses committed withdrawal: ${mutation}`, async () =>
    fixture(async (f) => {
      await f.publish();
      await f.pool.query(
        `CREATE FUNCTION withdraw() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN ${mutation}; RETURN NEW; END$$;CREATE TRIGGER withdraw AFTER INSERT ON digest_opt_out_tokens FOR EACH ROW EXECUTE FUNCTION withdraw()`,
      );
      await f.run();
      assert.equal(f.messages.length, 0);
    }));
test("midnight before dispatch returns claim to pending and extends catch-up on next run", async () =>
  fixture(async (f) => {
    await f.publish();
    await f.pool.query(
      `CREATE FUNCTION rollover() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE test_clock SET value='2026-11-23T00:00:01Z'; RETURN NEW; END$$;CREATE TRIGGER rollover AFTER INSERT ON digest_opt_out_tokens FOR EACH ROW EXECUTE FUNCTION rollover()`,
    );
    await f.run();
    assert.equal(f.messages.length, 0);
    await f.pool.query(`DROP TRIGGER rollover ON digest_opt_out_tokens`);
    await f.run();
    assert.equal(f.messages.length, 1);
    assert.equal(
      (
        await f.pool.query(
          `SELECT count(*) FROM digest_deliveries WHERE state='superseded'`,
        )
      ).rows[0].count,
      "1",
    );
  }));
test("permanent rejection closes immediately, and not-attempted errors do not retry", async () =>
  fixture(async (f) => {
    await f.publish();
    let calls = 0;
    await f.run(async () => {
      calls++;
      return {
        ok: false,
        reason: "unavailable",
        delivery: "rejected",
        retryable: false,
      };
    });
    await f.run();
    assert.equal(calls, 1);
    assert.equal(f.messages.length, 0);
  }));
test("expired, malformed, extra-field, oversized and concurrently replayed opt-out submissions fail safely", async () =>
  fixture(async (f) => {
    const { handleDigestOptOut } = await import("../../digests/opt-out-http");
    await f.publish();
    await f.run();
    const token = f.messages[0].text.match(/token=([\w-]+)/)![1];
    const deps = {
      db: f.db,
      origin: "https://atlas.test",
      locale: "fr" as const,
    };
    const post = (body: string) =>
      handleDigestOptOut(
        new Request("https://atlas.test/fr/digest-opt-out", {
          method: "POST",
          headers: {
            origin: "https://atlas.test",
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
        }),
        deps,
      );
    assert.equal(
      (await post(`token=${token}&userId=${f.recipient}`)).status,
      400,
    );
    assert.equal(
      (await post("token=" + token + "&token=" + token)).status,
      400,
    );
    assert.equal((await post("token=" + "a".repeat(1100))).status, 413);
    assert.equal((await post("token=%zz")).status, 400);
    await f.pool.query(
      `UPDATE digest_opt_out_tokens SET expires_at=clock_timestamp()`,
    );
    assert.match(await (await post("token=" + token)).text(), /invalide/);
    await f.pool.query(
      `UPDATE digest_opt_out_tokens SET expires_at=clock_timestamp()+interval '1 day'`,
    );
    const results = await Promise.all([
      post("token=" + token),
      post("token=" + token),
    ]);
    const bodies = await Promise.all(results.map((r) => r.text()));
    assert.equal(
      bodies.filter((b) => b.includes("Les résumés sont désactivés.")).length,
      1,
    );
  }));
for (const side of ["recipient", "uploader"] as const)
  test(`public erasure during in-flight transport withdraws ${side} authority without holding network locks`, async () =>
    fixture(async (f) => {
      const { eraseAccount } = await import("../../auth/account-erasure");
      const { rows: tables } = await control.pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'`,
      );
      for (const { tablename } of tables) {
        assert.match(tablename, /^[a-z_]+$/);
        await f.pool.query(
          `CREATE TABLE IF NOT EXISTS ${tablename}(LIKE public.${tablename} INCLUDING ALL)`,
        );
      }
      await f.publish();
      await f.run(async (m) => {
        f.messages.push(m);
        await eraseAccount({
          db: f.db,
          userId: f[side],
          confirmation: f[side],
          stores: [],
        });
        return { ok: true, messageId: "accepted-before-withdrawal" };
      });
      await f.run();
      assert.equal(f.messages.length, 1);
      assert.equal(
        (await f.pool.query(`SELECT count(*) FROM uploader_follows`)).rows[0]
          .count,
        "0",
      );
      if (side === "recipient") {
        for (const table of [
          "digest_deliveries",
          "digest_dispatch_days",
          "digest_opt_out_tokens",
        ])
          assert.equal(
            (await f.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,
            "0",
          );
      }
    }));
test("no-referrer opaque Origin requires matching trusted host and same-origin navigation metadata", async () =>
  fixture(async (f) => {
    const { handleDigestOptOut } = await import("../../digests/opt-out-http");
    await f.publish();
    await f.run();
    const token = f.messages[0].text.match(/token=([\w-]+)/)![1];
    const post = (extra: Record<string, string>) =>
      handleDigestOptOut(
        new Request("https://atlas.test/en/digest-opt-out", {
          method: "POST",
          headers: {
            origin: "null",
            "content-type": "application/x-www-form-urlencoded",
            ...extra,
          },
          body: "token=" + token,
        }),
        { db: f.db, origin: "https://atlas.test", locale: "en" },
      );
    assert.equal((await post({ host: "atlas.test" })).status, 403);
    assert.equal(
      (
        await post({
          host: "evil.test",
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "navigate",
        })
      ).status,
      403,
    );
    assert.match(
      await (
        await post({
          host: "atlas.test",
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "navigate",
        })
      ).text(),
      /Digest emails stopped/,
    );
  }));
test("bounded query summarizes all multi-track outputs once and does not carry overflow forward", async () =>
  fixture(async (f) => {
    for (let i = 0; i < 55; i++) await f.publish();
    await f.run();
    assert.equal(f.messages.length, 1);
    assert.match(f.messages[0].text, /55 new tracks/);
    assert.equal(
      (f.messages[0].text.match(/\/en\/tracks\//g) || []).length,
      50,
    );
    assert.match(f.messages[0].text, /5 more tracks/);
    await f.run();
    assert.equal(f.messages.length, 1);
  }));
test("quota clock rollover before reservation preserves work and charges only the later actual day", async () =>
  fixture(async (f) => {
    await f.publish();
    await f.pool.query(
      `CREATE FUNCTION quota_rollover() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE test_clock SET value='2026-11-23T00:00:01Z'; RETURN NEW; END$$;CREATE TRIGGER quota_rollover AFTER INSERT ON email_send_limits FOR EACH ROW EXECUTE FUNCTION quota_rollover()`,
    );
    await f.run();
    assert.equal(f.messages.length, 0);
    assert.equal(
      (
        await f.pool.query(
          `SELECT cardinality(attempted_at) AS n FROM email_send_limits`,
        )
      ).rows[0].n,
      0,
    );
    await f.pool.query(`DROP TRIGGER quota_rollover ON email_send_limits`);
    await f.run();
    assert.equal(f.messages.length, 1);
    assert.equal(
      (
        await f.pool.query(
          `SELECT cardinality(attempted_at) AS n FROM email_send_limits WHERE key='digest:daily:2026-11-23'`,
        )
      ).rows[0].n,
      1,
    );
  }));

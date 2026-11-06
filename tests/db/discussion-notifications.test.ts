import { createAcceptedSession as createSession } from "../helpers/accepted-session";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test, type TestContext } from "node:test";
import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import { users, tracks, storedFiles } from "../../db/schema";
import { signupFixture } from "./auth-helpers";
import { createTrackComment, getTrackComments } from "../../tracks/comments";
loadEnvConfig(process.cwd(), true);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Loopback database required");
const { db: liveDb, pool } = createDatabase(process.env.DATABASE_URL);
before(async () => {
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.EMAIL_RATE_LIMIT_SECRET =
    "synthetic-test-secret-with-at-least-32-bytes";
  process.env.EMAIL_DELIVERY_MODE = "capture";
  await liveDb.execute(
    sql`DELETE FROM email_send_limits WHERE key LIKE 'discussion:daily:%'`,
  );
});
after(() => pool.end());
async function fixture(t: TestContext) {
  const db = liveDb;
  const [owner, other] = await db
    .insert(users)
    .values(
      [signupFixture(), signupFixture()].map((x) => ({
        ...x,
        passwordHash: "synthetic",
      })),
    )
    .returning();
  t.after(async () => {
    for (const u of [owner, other]) {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`DELETE FROM track_upload_attempts WHERE owner_id=${u.id}::uuid`,
        );
        await tx.delete(tracks).where(eq(tracks.ownerId, u.id));
      });
    }
    for (const u of [owner, other]) {
      await db.delete(storedFiles).where(eq(storedFiles.ownerId, u.id));
      await db.delete(users).where(eq(users.id, u.id));
    }
  });
  const token = (await createSession(db, owner.id)).token;
  return { db, owner, other, token };
}
async function addTrack(
  f: Awaited<ReturnType<typeof fixture>>,
  ownerId = f.owner.id,
) {
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, ownerId));
  const data = new Map<string, Buffer>();
  const { createTrack } = await import("../../tracks/service");
  const track = await createTrack({
    db: f.db,
    token: (await createSession(f.db, ownerId)).token,
    store: {
      location: "b".repeat(64),
      put: async (k, v) => {
        data.set(k, v);
      },
      get: async (k) => data.get(k) ?? null,
      remove: async (k) => {
        data.delete(k);
      },
    },
    read: async () => ({
      requestId: randomUUID(),
      input: {
        name: "ridge",
        description: "a ridge",
        activity: "hiking",
        difficulty: 3,
        tags: [],
        visibility: "public",
      },
      bytes: Buffer.from(
        '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests"><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.01"/></trkseg></trk></gpx>',
      ),
    }),
  });
  return track;
}
test("active unconfirmed accounts can read and save only their own discussion preferences", async (t) => {
  const f = await fixture(t);
  const { handleDiscussionPreferencesRequest: handle } =
    await import("../../tracks/discussion-preferences-http");
  const origin = "http://localhost";
  const call = (
    method = "GET",
    input?: unknown,
    token: string | undefined = f.token,
  ) =>
    handle(
      new Request(origin + "/api/discussion-preferences", {
        method,
        headers: { origin, "content-type": "application/json" },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      }),
      { ...f, token, origin },
    );
  assert.deepEqual(await (await call()).json(), {
    enabled: true,
    locale: null,
  });
  for (const locale of ["en", "es", "fr", "pt", "de", "it"]) {
    assert.deepEqual(
      await (await call("PUT", { enabled: true, locale })).json(),
      { enabled: true, locale },
    );
    assert.deepEqual(await (await call()).json(), { enabled: true, locale });
  }
  assert.deepEqual(
    await (await call("PUT", { enabled: false, locale: "es" })).json(),
    { enabled: false, locale: "es" },
  );
  assert.deepEqual(await (await call()).json(), {
    enabled: false,
    locale: "es",
  });
  assert.equal(
    (await call("PUT", { enabled: true, locale: "en", userId: f.other.id }))
      .status,
    400,
  );
  assert.equal((await call("GET", undefined, "invalid")).status, 401);
});

test("new comments email the current owner in Spanish with a trusted direct link and no post text", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.other.id));
  const post = await createTrackComment({
    ...f,
    token: (await createSession(f.db, f.other.id)).token,
    id: track.id,
    input: { text: "PRIVATE COMMENT TEXT" },
  });
  await f.db
    .update(users)
    .set({ discussionEmailLocale: "es", displayName: "Owner" })
    .where(eq(users.id, f.owner.id));
  await f.db
    .update(users)
    .set({ displayName: "<Sender> {{secret}}" })
    .where(eq(users.id, f.other.id));
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.EMAIL_RATE_LIMIT_SECRET =
    "synthetic-test-secret-with-at-least-32-bytes";
  process.env.EMAIL_DELIVERY_MODE = "capture";
  const { deliverDiscussionNotification } =
    await import("../../tracks/discussion-notifications");
  const messages: import("../../email/types").EmailMessage[] = [];
  const result = await deliverDiscussionNotification({
    db: f.db,
    kind: "comment",
    postId: post.id,
    send: async (message) => {
      messages.push(message);
      return { ok: true, messageId: "capture" };
    },
  });
  assert.equal(result, "sent");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to.email, f.owner.email);
  assert.equal(messages[0].subject, "Nuevo comentario en tu recorrido");
  assert.ok(
    messages[0].text.includes(
      `http://localhost:3000/es/tracks/${track.id}?comment=${post.id}`,
    ),
  );
  assert.ok(messages[0].html.includes("&lt;Sender&gt;"));
  assert.ok(!JSON.stringify(messages).includes("PRIVATE COMMENT TEXT"));
  assert.ok(!messages[0].html.includes("{{secret}}"));
});

test("delivery rechecks current recipient confirmation, activity, toggle and ordinary track access; never self-notifies", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.other.id));
  const post = await createTrackComment({
    ...f,
    token: (await createSession(f.db, f.other.id)).token,
    id: track.id,
    input: { text: "question" },
  });
  const { createOwnerReply } = await import("../../tracks/comments");
  const reply = await createOwnerReply({
    ...f,
    id: track.id,
    commentId: post.id,
    input: { text: "answer" },
  });
  const { deliverDiscussionNotification: deliver } =
    await import("../../tracks/discussion-notifications");
  const messages: import("../../email/types").EmailMessage[] = [];
  const send: import("../../email/types").SendEmail = async (m) => {
    messages.push(m);
    return { ok: true, messageId: "capture" };
  };
  const call = () =>
    deliver({ db: f.db, kind: "reply", postId: reply.id, send });
  for (const patch of [
    { emailConfirmed: false },
    { active: false },
    { discussionEmailsEnabled: false },
  ]) {
    await f.db.update(users).set(patch).where(eq(users.id, f.other.id));
    assert.equal(await call(), "skipped");
    await f.db
      .update(users)
      .set({
        emailConfirmed: true,
        active: true,
        discussionEmailsEnabled: true,
      })
      .where(eq(users.id, f.other.id));
  }
  await f.db
    .update(tracks)
    .set({ visibility: "private" })
    .where(eq(tracks.id, track.id));
  assert.equal(await call(), "skipped");
  await f.db
    .update(tracks)
    .set({ visibility: "public" })
    .where(eq(tracks.id, track.id));
  await f.db
    .update(users)
    .set({ active: false })
    .where(eq(users.id, f.owner.id));
  assert.equal(await call(), "skipped");
  await f.db
    .update(users)
    .set({ active: true })
    .where(eq(users.id, f.owner.id));
  assert.equal(messages.length, 0);
  await f.db
    .update(users)
    .set({ email: "current-recipient@example.test" })
    .where(eq(users.id, f.other.id));
  assert.equal(await call(), "sent");
  assert.equal(messages[0].to.email, "current-recipient@example.test");
  assert.equal(messages[0].subject, "New reply to your comment");
  assert.ok(
    messages[0].text.includes(`/en/tracks/${track.id}?comment=${post.id}`),
  );
  await f.db.execute(
    sql`UPDATE discussion_post_events SET created_at=clock_timestamp()-interval '31 seconds' WHERE author_id=${f.owner.id}::uuid`,
  );
  const self = await createTrackComment({
    ...f,
    id: track.id,
    input: { text: "self" },
  });
  assert.equal(
    await deliver({ db: f.db, kind: "comment", postId: self.id, send }),
    "skipped",
  );
  await f.db.execute(sql`DELETE FROM track_comments WHERE id=${post.id}::uuid`);
  assert.equal(await call(), "skipped");
  assert.equal(messages.length, 1);
});

test("concurrent discussion attempts obey a separate configurable UTC budget and failed attempts stay charged", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.other.id));
  const post = await createTrackComment({
    ...f,
    token: (await createSession(f.db, f.other.id)).token,
    id: track.id,
    input: { text: "budget" },
  });
  await f.db.execute(
    sql`DELETE FROM email_send_limits WHERE key LIKE 'discussion:daily:%' OR key LIKE 'daily:%'`,
  );
  process.env.DISCUSSION_EMAIL_DAILY_LIMIT = "3";
  t.after(async () => {
    delete process.env.DISCUSSION_EMAIL_DAILY_LIMIT;
    await f.db.execute(
      sql`DELETE FROM email_send_limits WHERE key LIKE 'daily:%'`,
    );
  });
  const { deliverDiscussionNotification: deliver } =
    await import("../../tracks/discussion-notifications");
  let attempts = 0;
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      deliver({
        db: f.db,
        kind: "comment",
        postId: post.id,
        send: async () => {
          attempts++;
          return { ok: false, reason: "unavailable" };
        },
      }),
    ),
  );
  assert.equal(attempts, 3);
  assert.equal(results.filter((x) => x === "failed").length, 3);
  assert.equal(results.filter((x) => x === "budgetExhausted").length, 7);
  const { reserveEmailDailyBudget } =
    await import("../../auth/email-rate-limit");
  assert.equal(await reserveEmailDailyBudget(f.db), true);
  await f.db.execute(
    sql`UPDATE email_send_limits SET attempted_at=array_fill(clock_timestamp(),ARRAY[250]) WHERE key LIKE 'daily:%'`,
  );
  await f.db.execute(
    sql`DELETE FROM email_send_limits WHERE key LIKE 'discussion:daily:%'`,
  );
  assert.equal(await reserveEmailDailyBudget(f.db), false);
  assert.equal(
    await deliver({
      db: f.db,
      kind: "comment",
      postId: post.id,
      send: async () => ({ ok: true, messageId: "capture" }),
    }),
    "sent",
  );
});

test("HTTP post commits before one failing transport attempt and still returns 201", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.other.id));
  const token = (await createSession(f.db, f.other.id)).token;
  const { handleCommentsRequest } = await import("../../tracks/comments-http");
  let attempts = 0;
  let observedText: string | undefined;
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  t.after(() => {
    console.error = original;
  });
  const response = await handleCommentsRequest(
    new Request("http://localhost/api/tracks/" + track.id + "/comments", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "Never include this in logs" }),
    }),
    {
      ...f,
      token,
      origin: "http://localhost",
      send: async () => {
        attempts++;
        observedText = (await getTrackComments({ ...f, id: track.id }))
          ?.comments[0].text;
        throw Error("secret-provider-key and recipient@example.test");
      },
    },
    track.id,
  );
  assert.equal(response.status, 201);
  const post = await response.json();
  assert.equal(attempts, 1);
  assert.equal(observedText, "Never include this in logs");
  assert.equal(
    (await getTrackComments({ ...f, id: track.id, commentId: post.commentId }))
      ?.total,
    1,
  );
  assert.equal(logs.length, 1);
  assert.ok(!JSON.stringify(logs).includes("secret-provider-key"));
  assert.ok(!JSON.stringify(logs).includes("Never include this in logs"));
  assert.ok(!JSON.stringify(logs).includes("recipient@example.test"));
});

test("preference HTTP rejects unsafe requests and leaves the saved values unchanged", async (t) => {
  const f = await fixture(t);
  const { handleDiscussionPreferencesRequest: handle } =
    await import("../../tracks/discussion-preferences-http");
  const origin = "http://localhost";
  for (const [method, body, headers, query, status] of [
    [
      "PUT",
      '{"enabled":true,"locale":"en"}',
      { origin: "http://evil.test" },
      "",
      403,
    ],
    [
      "PUT",
      '{"enabled":true,"locale":"en"}',
      { "sec-fetch-site": "cross-site" },
      "",
      403,
    ],
    [
      "PUT",
      '{"enabled":true,"locale":"en"}',
      { "content-type": "text/plain" },
      "",
      400,
    ],
    [
      "PUT",
      '{"enabled":true,"locale":"en"}',
      { "content-encoding": "gzip" },
      "",
      400,
    ],
    ["PUT", '{"enabled":true,"locale":null}', {}, "", 400],
    ["PUT", '{"enabled":"true","locale":"en"}', {}, "", 400],
    ["PUT", '{"enabled":false,"locale":"nl"}', {}, "", 400],
    ["PUT", '{"enabled":false}', {}, "", 400],
    ["PUT", "{", {}, "", 400],
    ["PUT", " ".repeat(1025), {}, "", 413],
    ["GET", undefined, {}, "?userId=other", 400],
    ["POST", "{}", {}, "", 405],
  ] as const) {
    const response = await handle(
      new Request(origin + "/api/discussion-preferences" + query, {
        method,
        headers: Object.assign(
          { origin, "content-type": "application/json" },
          headers,
        ),
        ...(body === undefined ? {} : { body }),
      }),
      { ...f, origin },
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
  const { getDiscussionPreferences } =
    await import("../../tracks/discussion-preferences");
  assert.deepEqual(await getDiscussionPreferences(f), {
    enabled: true,
    locale: null,
  });
});

async function waitForBlocker(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (
      (
        await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))",
          [pid],
        )
      ).rowCount
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error("Expected database lock wait");
}
for (const change of [
  "deactivation",
  "revocation",
  "expiry",
  "ownership",
] as const) {
  test(`preference update rechecks ${change} after a lock wait`, async (t) => {
    const f = await fixture(t);
    const { updateDiscussionPreferences, getDiscussionPreferences } =
      await import("../../tracks/discussion-preferences");
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        f.owner.id,
      ]);
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      const rejected = assert.rejects(
        updateDiscussionPreferences({
          ...f,
          input: { enabled: false, locale: "es" },
        }),
        { message: "unauthorized" },
      );
      await waitForBlocker(pid);
      if (change === "deactivation")
        await blocker.query("UPDATE users SET active=false WHERE id=$1", [
          f.owner.id,
        ]);
      if (change === "revocation")
        await blocker.query("DELETE FROM sessions WHERE user_id=$1", [
          f.owner.id,
        ]);
      if (change === "ownership")
        await blocker.query("UPDATE sessions SET user_id=$2 WHERE user_id=$1", [
          f.owner.id,
          f.other.id,
        ]);
      if (change === "expiry")
        await blocker.query(
          "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
          [f.owner.id],
        );
      await blocker.query("COMMIT");
      await rejected;
      await f.db
        .update(users)
        .set({ active: true })
        .where(eq(users.id, f.owner.id));
      assert.deepEqual(
        await getDiscussionPreferences({
          ...f,
          token: (await createSession(f.db, f.owner.id)).token,
        }),
        { enabled: true, locale: null },
      );
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
}

test("eligibility is rechecked after waiting for the discussion budget lock", async (t) => {
  const f = await fixture(t),
    track = await addTrack(f);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.other.id));
  const post = await createTrackComment({
    ...f,
    token: (await createSession(f.db, f.other.id)).token,
    id: track.id,
    input: { text: "question" },
  });
  const { deliverDiscussionNotification: deliver } =
    await import("../../tracks/discussion-notifications");
  const blocker = await pool.connect();
  let attempts = 0;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(247192614)");
    const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0]
      .pid;
    const pending = deliver({
      db: f.db,
      kind: "comment",
      postId: post.id,
      send: async () => {
        attempts++;
        return { ok: true, messageId: "capture" };
      },
    });
    await waitForBlocker(pid);
    await blocker.query(
      "UPDATE users SET discussion_emails_enabled=false WHERE id=$1",
      [f.owner.id],
    );
    await blocker.query("COMMIT");
    assert.equal(await pending, "skipped");
    assert.equal(attempts, 0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
});

test("zero or invalid discussion budget skips transport while HTTP creation succeeds", async (t) => {
  const f = await fixture(t),
    track = await addTrack(f);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.other.id));
  const token = (await createSession(f.db, f.other.id)).token;
  const { handleCommentsRequest } = await import("../../tracks/comments-http");
  t.after(() => {
    delete process.env.DISCUSSION_EMAIL_DAILY_LIMIT;
  });
  const original = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => logs.push(args);
  t.after(() => {
    console.error = original;
  });
  for (const value of ["0", "-1", "invalid"]) {
    process.env.DISCUSSION_EMAIL_DAILY_LIMIT = value;
    await f.db.execute(
      sql`UPDATE discussion_post_events SET created_at=clock_timestamp()-interval '31 seconds' WHERE author_id=${f.other.id}::uuid`,
    );
    let attempts = 0;
    const response = await handleCommentsRequest(
      new Request("http://localhost/api/tracks/" + track.id + "/comments", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: '{"text":"saved"}',
      }),
      {
        ...f,
        token,
        origin: "http://localhost",
        send: async () => {
          attempts++;
          return { ok: true, messageId: "capture" };
        },
      },
      track.id,
    );
    assert.equal(response.status, 201);
    assert.equal(attempts, 0);
  }
  assert.equal((await getTrackComments({ ...f, id: track.id }))?.total, 3);
  assert.equal(logs.length, 2);
});

test("default discussion allowance is 250 and a UTC midnight crossed during a lock wait uses the new day", async (t) => {
  const f = await fixture(t),
    track = await addTrack(f);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.other.id));
  const post = await createTrackComment({
    ...f,
    token: (await createSession(f.db, f.other.id)).token,
    id: track.id,
    input: { text: "clock" },
  });
  const schema = "discussion_clock_" + randomUUID().replaceAll("-", "");
  await pool.query(`CREATE SCHEMA ${schema}`);
  let instance: ReturnType<typeof createDatabase> | undefined;
  const blocker = await pool.connect();
  try {
    await pool.query(
      `CREATE TABLE ${schema}.email_send_limits (LIKE public.email_send_limits INCLUDING ALL)`,
    );
    await pool.query(
      `CREATE TABLE ${schema}.test_clock(value timestamptz NOT NULL)`,
    );
    await pool.query(
      `INSERT INTO ${schema}.test_clock VALUES ('2026-01-01T23:59:59Z')`,
    );
    // Test-only clock in an isolated schema; production code has no clock bypass.
    await pool.query(
      `CREATE FUNCTION ${schema}.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE AS 'SELECT value FROM ${schema}.test_clock'`,
    );
    await pool.query(
      `INSERT INTO ${schema}.email_send_limits(key,attempted_at) VALUES ('discussion:daily:2026-01-01',array_fill('2026-01-01T12:00:00Z'::timestamptz,ARRAY[250]))`,
    );
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set(
      "options",
      `-csearch_path=${schema},pg_catalog,public -cTimeZone=Pacific/Honolulu`,
    );
    instance = createDatabase(url.href);
    const { deliverDiscussionNotification: deliver } =
      await import("../../tracks/discussion-notifications");
    let attempts = 0;
    const call = () =>
      deliver({
        db: instance!.db,
        kind: "comment",
        postId: post.id,
        send: async () => {
          attempts++;
          return { ok: true, messageId: "capture" };
        },
      });
    assert.equal(await call(), "budgetExhausted");
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(247192614)");
    const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0]
      .pid;
    const pending = call();
    await waitForBlocker(pid);
    await pool.query(
      `UPDATE ${schema}.test_clock SET value='2026-01-02T00:00:01Z'`,
    );
    await blocker.query("COMMIT");
    assert.equal(await pending, "sent");
    const results = await Promise.all(Array.from({ length: 250 }, call));
    assert.equal(results.filter((x) => x === "sent").length, 249);
    assert.equal(results.filter((x) => x === "budgetExhausted").length, 1);
    assert.equal(attempts, 250);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await instance?.pool.end();
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  }
});

test("owner reply POST sends one English notification to its parent author", async (t) => {
  const f = await fixture(t),
    track = await addTrack(f);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.other.id));
  const post = await createTrackComment({
    ...f,
    token: (await createSession(f.db, f.other.id)).token,
    id: track.id,
    input: { text: "question" },
  });
  const { handleCommentsRequest } = await import("../../tracks/comments-http");
  const messages: import("../../email/types").EmailMessage[] = [];
  const response = await handleCommentsRequest(
    new Request("http://localhost/api/reply", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: '{"text":"private answer text"}',
    }),
    {
      ...f,
      origin: "http://localhost",
      send: async (m) => {
        messages.push(m);
        return { ok: true, messageId: "capture" };
      },
    },
    track.id,
    post.id,
  );
  assert.equal(response.status, 201);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to.email, f.other.email);
  assert.equal(messages[0].subject, "New reply to your comment");
  assert.ok(
    messages[0].text.includes(`/en/tracks/${track.id}?comment=${post.id}`),
  );
  assert.ok(!JSON.stringify(messages).includes("private answer text"));
});

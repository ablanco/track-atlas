import { createAcceptedSession as createSession } from "../helpers/accepted-session";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test, type TestContext } from "node:test";
import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../../db/client";
import { fixtureUser } from "./auth-helpers";
import { getAdminRecord, listAdminRecords } from "../../admin/queries";
import { createTrack } from "../../tracks/service";
import { handleAdminRead } from "../../admin/http";

loadEnvConfig(process.cwd(), true);
if (
  !process.env.DATABASE_URL ||
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(process.env.DATABASE_URL).hostname,
  )
)
  throw Error("Loopback development database required");
const { db, pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
const recordId = (id: string) => JSON.stringify([id]);
async function fixture(t: TestContext) {
  const client = await pool.connect();
  const actor = await fixtureUser(client),
    owner = await fixtureUser(client),
    author = await fixtureUser(client);
  client.release();
  t.after(async () => {
    const ids = [actor, owner, author];
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");
      await cleanup.query(
        "DELETE FROM track_upload_attempts WHERE owner_id=ANY($1::uuid[])",
        [ids],
      );
      await cleanup.query("DELETE FROM tracks WHERE owner_id=ANY($1::uuid[])", [
        ids,
      ]);
      await cleanup.query("COMMIT");
    } catch (error) {
      await cleanup.query("ROLLBACK");
      throw error;
    } finally {
      cleanup.release();
    }
    await pool.query(
      "DELETE FROM stored_files WHERE owner_id=ANY($1::uuid[])",
      [ids],
    );
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  });
  await pool.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  await pool.query(
    "UPDATE users SET email_confirmed=true WHERE id=ANY($1::uuid[])",
    [[actor, owner, author]],
  );
  const token = (await createSession(db, actor)).token;
  const ownerToken = (await createSession(db, owner)).token;
  const { id: track } = await createTrack({
    db,
    token: ownerToken,
    store: {
      location: "a".repeat(64),
      put: async () => {},
      get: async () => null,
      remove: async () => {},
    },
    read: async () => ({
      requestId: randomUUID(),
      input: {
        name: "Private discussion",
        description: "Test",
        activity: "hiking",
        difficulty: 1,
        tags: [],
        visibility: "private",
      },
      bytes: Buffer.from(
        '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests"><trk><trkseg><trkpt lat="40" lon="1"/><trkpt lat="40.01" lon="1.01"/></trkseg></trk></gpx>',
      ),
    }),
  });
  const comment = (
    await pool.query(
      "INSERT INTO track_comments(track_id,author_id,text) VALUES($1,$2,'Question 100%_') RETURNING id",
      [track, author],
    )
  ).rows[0].id as string;
  const reply = (
    await pool.query(
      "INSERT INTO track_comment_replies(comment_id,author_id,text) VALUES($1,$2,'Answer') RETURNING id",
      [comment, owner],
    )
  ).rows[0].id as string;
  return { actor, owner, author, token, ownerToken, track, comment, reply };
}

test("admin inspects private retained comments and replies with safe linked details and allowlisted queries", async (t) => {
  const f = await fixture(t);
  await pool.query("UPDATE users SET active=false WHERE id=ANY($1::uuid[])", [
    [f.owner, f.author],
  ]);
  for (const [model, id, filters, relations] of [
    [
      "track_comments",
      f.comment,
      { track_id: f.track, author_id: f.author },
      ["track_id", "author_id"],
    ],
    [
      "track_comment_replies",
      f.reply,
      { comment_id: f.comment, author_id: f.owner },
      ["comment_id", "author_id"],
    ],
  ] as const) {
    const page = await listAdminRecords(
      db,
      f.token,
      model,
      new URLSearchParams({
        ...filters,
        sort: "text",
        direction: "asc",
        pageSize: "25",
      }),
    );
    assert.equal(page.total, 1);
    assert.equal(page.rows[0].id, recordId(id));
    assert.equal(page.rows[0].selectable, true);
    const detail = await getAdminRecord(db, f.token, model, recordId(id));
    assert.deepEqual(
      detail.record.related.map((r) => r.field).sort(),
      [...relations].sort(),
    );
    for (const related of detail.record.related) {
      assert.equal(
        (await getAdminRecord(db, f.token, related.model, related.id)).record
          .id,
        related.id,
      );
    }
    assert.ok(
      !/password_hash|token_hash|storage_location|object_key/.test(
        JSON.stringify(detail),
      ),
    );
    const response = await handleAdminRead(
      new Request("http://localhost/api/admin/" + model),
      db,
      f.token,
      model,
      recordId(id),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    await assert.rejects(
      listAdminRecords(db, undefined, model, new URLSearchParams()),
      { code: "unauthorized" },
    );
    await assert.rejects(
      listAdminRecords(
        db,
        f.token,
        model,
        new URLSearchParams({ sort: "password_hash" }),
      ),
      { code: "invalidRequest" },
    );
  }
  const search = await listAdminRecords(
    db,
    f.token,
    "track_comments",
    new URLSearchParams({ q: "100%_", track_id: f.track }),
  );
  assert.equal(search.total, 1);
  assert.equal(
    (
      await listAdminRecords(
        db,
        f.token,
        "track_comments",
        new URLSearchParams({ q: "absent", track_id: f.track }),
      )
    ).total,
    0,
  );
  await assert.rejects(
    listAdminRecords(
      db,
      f.token,
      "discussion_post_events",
      new URLSearchParams(),
    ),
    { code: "invalidRequest" },
  );
});

test("admin edits only normalized discussion text and preserves authors, associations and original dates", async (t) => {
  const { mutateAdminRecords } = await import("../../admin/mutations");
  const f = await fixture(t);
  await pool.query("UPDATE users SET active=false WHERE id=ANY($1::uuid[])", [
    [f.owner, f.author],
  ]);
  for (const [model, id] of [
    ["track_comments", f.comment],
    ["track_comment_replies", f.reply],
  ]) {
    const before = (await getAdminRecord(db, f.token, model, recordId(id)))
      .record.values;
    let sent = false;
    assert.deepEqual(
      await mutateAdminRecords(
        db,
        f.token,
        {
          model,
          operation: "update",
          ids: [recordId(id)],
          values: { text: "  Revised\n<b>plain</b> 😀  " },
        },
        {
          send: async () => {
            sent = true;
            return { ok: true, messageId: "test" };
          },
        },
      ),
      { ok: true },
    );
    const after = (await getAdminRecord(db, f.token, model, recordId(id)))
      .record.values;
    assert.equal(after.text, "Revised\n<b>plain</b> 😀");
    for (const key of Object.keys(before).filter(
      (k) => !["text", "updated_at"].includes(k),
    ))
      assert.deepEqual(after[key], before[key]);
    assert.notEqual(String(after.updated_at), String(before.updated_at));
    assert.equal(sent, false);
    for (const values of [
      { text: " " },
      { text: "a".repeat(2001) },
      { text: "\0" },
      { text: "\ud800" },
      { text: 1 },
      { author_id: f.actor },
      { created_at: "2020-01-01" },
      { text: "x", id: randomUUID() },
      { track_id: f.track },
      { comment_id: f.comment },
    ]) {
      await assert.rejects(
        mutateAdminRecords(db, f.token, {
          model,
          operation: "update",
          ids: [recordId(id)],
          values,
        }),
        { code: "invalidRequest" },
      );
    }
    await mutateAdminRecords(db, f.token, {
      model,
      operation: "update",
      ids: [recordId(id)],
      values: { text: "😀".repeat(2000) },
    });
    assert.equal(
      (await getAdminRecord(db, f.token, model, recordId(id))).record.values
        .text,
      "😀".repeat(2000),
    );
  }
  for (const field of [
    "discussion_emails_enabled",
    "discussion_email_locale",
    "discussionEmailsEnabled",
    "discussionEmailLocale",
  ]) {
    await assert.rejects(
      mutateAdminRecords(db, f.token, {
        model: "users",
        operation: "update",
        ids: [recordId(f.author)],
        values: { [field]: false },
      }),
      { code: "invalidRequest" },
    );
  }
});

test("atomic moderation deletes preserve posting limits, cascade replies and permit owner reply recreation", async (t) => {
  const { mutateAdminRecords } = await import("../../admin/mutations");
  const { createOwnerReply, createTrackComment, getTrackComments } =
    await import("../../tracks/comments");
  const f = await fixture(t);
  for (const [model, id] of [
    ["track_comments", f.comment],
    ["track_comment_replies", f.reply],
  ]) {
    await assert.rejects(
      mutateAdminRecords(db, f.token, {
        model,
        operation: "delete",
        ids: [recordId(id), recordId(randomUUID())],
      }),
      { code: "notFound" },
    );
    assert.equal(
      (await getAdminRecord(db, f.token, model, recordId(id))).record.values.id,
      id,
    );
  }
  await assert.rejects(
    createOwnerReply({
      db,
      token: f.token,
      id: f.track,
      commentId: f.comment,
      input: { text: "Admin cannot reply" },
    }),
    { code: "notFound" },
  );
  await mutateAdminRecords(db, f.token, {
    model: "track_comment_replies",
    operation: "delete",
    ids: [recordId(f.reply)],
  });
  assert.equal(
    (await getTrackComments({ db, token: f.ownerToken, id: f.track }))
      ?.comments[0].reply,
    null,
  );
  const replacement = await createOwnerReply({
    db,
    token: f.ownerToken,
    id: f.track,
    commentId: f.comment,
    input: { text: "Replacement" },
  });
  assert.notEqual(replacement.id, f.reply);
  await mutateAdminRecords(db, f.token, {
    model: "track_comments",
    operation: "delete",
    ids: [recordId(f.comment)],
  });
  for (const [model, id] of [
    ["track_comments", f.comment],
    ["track_comment_replies", replacement.id],
  ])
    await assert.rejects(getAdminRecord(db, f.token, model, recordId(id)), {
      code: "notFound",
    });
  await assert.rejects(
    createTrackComment({
      db,
      token: f.ownerToken,
      id: f.track,
      input: { text: "Cannot reset allowance" },
    }),
    { code: "rateLimited" },
  );
  assert.equal(
    (await getTrackComments({ db, token: f.ownerToken, id: f.track }))?.total,
    0,
  );
});

test("HTTP moderation reauthorizes, rejects creation and immutable fields, and commits valid batches", async (t) => {
  const { handleAdminMutation } = await import("../../admin/mutation-http");
  const f = await fixture(t);
  const origin = "http://localhost:3000";
  const send = async () => {
    throw Error("Moderation must not send email");
  };
  async function request(
    body: unknown,
    token: string | null = f.token,
    extra: Record<string, string> = {},
  ) {
    return handleAdminMutation(
      new Request(origin + "/api/admin/mutations", {
        method: "POST",
        headers: { origin, "content-type": "application/json", ...extra },
        body: JSON.stringify(body),
      }),
      { db, token: token ?? undefined, origin, send },
    );
  }
  for (const model of ["track_comments", "track_comment_replies"]) {
    const id = model === "track_comments" ? f.comment : f.reply;
    const body = {
      model,
      operation: "update",
      ids: [recordId(id)],
      values: { text: "HTTP saved" },
    };
    for (const [token, status] of [
      [null, 401],
      [f.ownerToken, 403],
    ] as const)
      assert.equal((await request(body, token)).status, status);
    for (const invalid of [
      { ...body, operation: "create" },
      { ...body, values: { text: "x", author_id: f.actor } },
      { ...body, values: { text: "\ud800" } },
      { ...body, values: { text: "" } },
    ]) {
      const response = await request(invalid);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalidRequest" });
    }
    assert.equal(
      (await request(body, f.token, { "sec-fetch-site": "cross-site" })).status,
      403,
    );
    const saved = await request(body);
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get("cache-control"), "private, no-store");
    assert.equal(
      (await getAdminRecord(db, f.token, model, recordId(id))).record.values
        .text,
      "HTTP saved",
    );
  }
  const other = (
    await pool.query(
      "INSERT INTO track_comments(track_id,author_id,text) VALUES($1,$2,'Another') RETURNING id",
      [f.track, f.author],
    )
  ).rows[0].id;
  assert.equal(
    (
      await request({
        model: "track_comments",
        operation: "delete",
        ids: [recordId(f.comment), recordId(other)],
      })
    ).status,
    200,
  );
  for (const id of [f.comment, other])
    await assert.rejects(
      getAdminRecord(db, f.token, "track_comments", recordId(id)),
      { code: "notFound" },
    );
});

test("moderation rechecks privileges and session expiry after account and track lock waits", async (t) => {
  const { mutateAdminRecords } = await import("../../admin/mutations");
  for (const model of ["track_comments", "track_comment_replies"]) {
    for (const revoked of [true, false]) {
      const f = await fixture(t);
      const id = model === "track_comments" ? f.comment : f.reply;
      const blocker = await pool.connect();
      try {
        if (!revoked)
          await pool.query(
            "UPDATE sessions SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE user_id=$1",
            [f.actor],
          );
        await blocker.query("BEGIN");
        await blocker.query(
          revoked
            ? "SELECT id FROM users WHERE id=$1 FOR UPDATE"
            : "SELECT id FROM tracks WHERE id=$1 FOR UPDATE",
          [revoked ? f.actor : f.track],
        );
        const pending = assert.rejects(
          mutateAdminRecords(db, f.token, {
            model,
            operation: "update",
            ids: [recordId(id)],
            values: { text: "Rejected" },
          }),
          { code: revoked ? "forbidden" : "unauthorized" },
        );
        await new Promise((resolve) =>
          setTimeout(resolve, revoked ? 100 : 450),
        );
        if (revoked)
          await blocker.query("UPDATE users SET admin=false WHERE id=$1", [
            f.actor,
          ]);
        await blocker.query("COMMIT");
        await pending;
        // Restore inspection authority without changing the post under test.
        await pool.query("UPDATE users SET admin=true WHERE id=$1", [f.actor]);
        const token = (await createSession(db, f.actor)).token;
        assert.equal(
          (await getAdminRecord(db, token, model, recordId(id))).record.values
            .text,
          model === "track_comments" ? "Question 100%_" : "Answer",
        );
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
    }
  }
});

test("moderation and owner posting serialize safely and deletion cannot grant ordinary admin reply rights", async (t) => {
  const { mutateAdminRecords } = await import("../../admin/mutations");
  const { createOwnerReply, getTrackComments } =
    await import("../../tracks/comments");
  const f = await fixture(t);
  await pool.query("UPDATE tracks SET visibility='public' WHERE id=$1", [
    f.track,
  ]);
  await assert.rejects(
    createOwnerReply({
      db,
      token: f.token,
      id: f.track,
      commentId: f.comment,
      input: { text: "No owner rights" },
    }),
    { code: "forbidden" },
  );
  await mutateAdminRecords(db, f.token, {
    model: "track_comment_replies",
    operation: "delete",
    ids: [recordId(f.reply)],
  });
  const results = await Promise.allSettled([
    mutateAdminRecords(db, f.token, {
      model: "track_comments",
      operation: "delete",
      ids: [recordId(f.comment)],
    }),
    createOwnerReply({
      db,
      token: f.ownerToken,
      id: f.track,
      commentId: f.comment,
      input: { text: "Concurrent reply" },
    }),
  ]);
  assert.equal(results[0].status, "fulfilled");
  if (results[1].status === "rejected")
    assert.equal(results[1].reason.code, "notFound");
  assert.equal(
    (await getTrackComments({ db, token: f.ownerToken, id: f.track }))?.total,
    0,
  );
});

test("a target deleted during the bulk lock wait rolls back earlier deletions and cascades", async (t) => {
  const { mutateAdminRecords } = await import("../../admin/mutations");
  const f = await fixture(t);
  const other = (
    await pool.query(
      "INSERT INTO track_comments(track_id,author_id,text) VALUES($1,$2,'Concurrent target') RETURNING id",
      [f.track, f.author],
    )
  ).rows[0].id;
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM tracks WHERE id=$1 FOR UPDATE", [
      f.track,
    ]);
    const pending = assert.rejects(
      mutateAdminRecords(db, f.token, {
        model: "track_comments",
        operation: "delete",
        ids: [recordId(f.comment), recordId(other)],
      }),
      { code: "notFound" },
    );
    // Wait until moderation has read both targets and is blocked on this track.
    const deadline = Date.now() + 5000;
    while (true) {
      const waiting = await pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM tracks WHERE id IN%'",
      );
      if (waiting.rows.length) break;
      assert.ok(Date.now() < deadline, "moderation reached the track lock");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await blocker.query("DELETE FROM track_comments WHERE id=$1", [other]);
    await blocker.query("COMMIT");
    await pending;
    assert.equal(
      (await getAdminRecord(db, f.token, "track_comments", recordId(f.comment)))
        .record.values.text,
      "Question 100%_",
    );
    assert.equal(
      (
        await getAdminRecord(
          db,
          f.token,
          "track_comment_replies",
          recordId(f.reply),
        )
      ).record.values.text,
      "Answer",
    );
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
});

test("comment and reply filters, literal search, deterministic sorting and paging precede bulk selection", async (t) => {
  const f = await fixture(t);
  await pool.query(
    "WITH comments AS (INSERT INTO track_comments(track_id,author_id,text,created_at) SELECT $1,$2,'Entry '||lpad(i::text,2,'0'), '2020-01-01'::timestamptz FROM generate_series(1,30) i RETURNING id,text) INSERT INTO track_comment_replies(comment_id,author_id,text,created_at) SELECT id,$3,text,'2020-01-01'::timestamptz FROM comments",
    [f.track, f.author, f.owner],
  );
  for (const [model, author] of [
    ["track_comments", f.author],
    ["track_comment_replies", f.owner],
  ]) {
    const params = {
      author_id: author,
      q: "Entry",
      sort: "text",
      direction: "asc",
      pageSize: "25",
    };
    const first = await listAdminRecords(
      db,
      f.token,
      model,
      new URLSearchParams(params),
    );
    const second = await listAdminRecords(
      db,
      f.token,
      model,
      new URLSearchParams({ ...params, page: "2" }),
    );
    assert.equal(first.total, 30);
    assert.equal(first.rows.length, 25);
    assert.equal(first.rows[0].values.text, "Entry 01");
    assert.equal(first.rows[24].values.text, "Entry 25");
    assert.equal(second.rows.length, 5);
    assert.equal(second.rows[0].values.text, "Entry 26");
    assert.equal(second.rows[4].values.text, "Entry 30");
    const clamped = await listAdminRecords(
      db,
      f.token,
      model,
      new URLSearchParams({ ...params, page: "999", direction: "desc" }),
    );
    assert.equal(clamped.page, 2);
    assert.equal(clamped.rows[4].values.text, "Entry 01");
    await assert.rejects(
      listAdminRecords(
        db,
        f.token,
        model,
        new URLSearchParams("author_id=" + author + "&author_id=" + author),
      ),
      { code: "invalidRequest" },
    );
  }
});

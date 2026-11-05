import { createAcceptedSession as createSession } from "../helpers/accepted-session";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test, type TestContext } from "node:test";
import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import { users, tracks, storedFiles } from "../../db/schema";
import { signupFixture } from "./auth-helpers";
import { deleteTrack } from "../../tracks/service";
import { createTrackComment, getTrackComments } from "../../tracks/comments";
loadEnvConfig(process.cwd(), true);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Loopback database required");
const { db: liveDb, pool } = createDatabase(process.env.DATABASE_URL);
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
test("confirmed owner can leave plain text on their own track and read it as a guest", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  const result = await createTrackComment({
    ...f,
    id: track.id,
    input: { text: "  Hello\n<b>world</b> 😀  " },
  });
  assert.equal(result.page, 1);
  const page = await getTrackComments({ ...f, token: undefined, id: track.id });
  assert.equal(page?.total, 1);
  assert.equal(page?.comments[0].text, "Hello\n<b>world</b> 😀");
  assert.equal(page?.comments[0].id, result.commentId);
  assert.equal(page?.comments[0].reply, null);
  assert.equal(page?.posting, "login");
});

test("posting is account-wide and concurrent attempts allow only one post in thirty seconds", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      createTrackComment({
        ...f,
        id: track.id,
        input: { text: "one attempt" },
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const result of results)
    if (result.status === "rejected")
      assert.equal(result.reason.message, "rateLimited");
  assert.equal((await getTrackComments({ ...f, id: track.id }))?.total, 1);
});

test("owner alone can reply once, reply shares throttle and travels with its parent", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.owner.id));
  const comment = await createTrackComment({
    ...f,
    id: track.id,
    input: { text: "question" },
  });
  const { createOwnerReply } = await import("../../tracks/comments");
  await assert.rejects(
    createOwnerReply({
      ...f,
      id: track.id,
      commentId: comment.id,
      input: { text: "no" },
    }),
    { message: "forbidden" },
  );
  const token = (await createSession(f.db, f.other.id)).token;
  const reply = await createOwnerReply({
    ...f,
    token,
    id: track.id,
    commentId: comment.id,
    input: { text: " answer " },
  });
  assert.equal(reply.commentId, comment.id);
  assert.notEqual(reply.id, comment.id);
  const page = await getTrackComments({ ...f, token, id: track.id });
  assert.equal(page?.total, 1);
  assert.equal(page?.comments[0].reply?.text, "answer");
  assert.equal(page?.comments[0].canReply, false);
  await assert.rejects(
    createOwnerReply({
      ...f,
      token,
      id: track.id,
      commentId: comment.id,
      input: { text: "again" },
    }),
    { message: "replyExists" },
  );
  await assert.rejects(
    createOwnerReply({
      ...f,
      token,
      id: track.id,
      commentId: reply.id,
      input: { text: "nested" },
    }),
    { message: "notFound" },
  );
  await assert.rejects(
    createTrackComment({
      ...f,
      token,
      id: track.id,
      input: { text: "too soon" },
    }),
    { message: "rateLimited" },
  );
});

test("HTTP posts and reads are bounded, private, origin checked and reject identity or mutation attempts", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  const { handleCommentsRequest } = await import("../../tracks/comments-http");
  const origin = "http://localhost";
  const call = (
    method = "GET",
    body?: string,
    headers: Record<string, string> = {},
    query = "",
  ) =>
    handleCommentsRequest(
      new Request(`${origin}/api/tracks/${track.id}/comments${query}`, {
        method,
        headers: { origin, "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body }),
      }),
      { ...f, origin },
      track.id,
    );
  for (const [method, body, headers, query, status] of [
    ["POST", '{"text":"x"}', { origin: "http://evil.test" }, "", 403],
    ["POST", '{"text":"x"}', { "sec-fetch-site": "cross-site" }, "", 403],
    ["POST", '{"text":"x","authorId":"forged"}', {}, "", 400],
    ["POST", '{"text":', {}, "", 400],
    ["POST", '{"text":"x"}', { "content-encoding": "gzip" }, "", 400],
    ["POST", JSON.stringify({ text: "x".repeat(17000) }), {}, "", 413],
    ["POST", '{"text":"x"}', {}, "?page=1", 400],
    ["GET", undefined, {}, "?page=1&page=2", 400],
    ["GET", undefined, {}, "?page=1e2", 400],
    ["GET", undefined, {}, "?unexpected=x", 400],
    ["DELETE", undefined, {}, "", 405],
  ] as const) {
    const response = await call(method, body, headers, query);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  const created = await call("POST", '{"text":"hello"}');
  assert.equal(created.status, 201);
  const post = await created.json();
  const read = await call("GET", undefined, {}, "?comment=" + post.commentId);
  assert.equal(read.status, 200);
  assert.equal((await read.json()).comments[0].text, "hello");
  assert.equal((await call("POST", '{"text":"again"}')).status, 429);
});

test("current author identity and only their derived avatar are exposed under track authority", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  const comment = await createTrackComment({
    ...f,
    id: track.id,
    input: { text: "retained" },
  });
  const sharp = (await import("sharp")).default;
  const data = new Map<string, Buffer>();
  const store = {
    location: "b".repeat(64),
    put: async (key: string, bytes: Buffer) => {
      data.set(key, bytes);
    },
    get: async (key: string) => data.get(key) ?? null,
    remove: async (key: string) => {
      data.delete(key);
    },
  };
  const { uploadFile } = await import("../../storage/files");
  await uploadFile({
    ...f,
    store,
    purpose: "avatar",
    contentType: "image/png",
    read: async () =>
      sharp({
        create: { width: 40, height: 40, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
  });
  await f.db
    .update(users)
    .set({ displayName: "Current name" })
    .where(eq(users.id, f.owner.id));
  const page = await getTrackComments({ ...f, id: track.id });
  assert.equal(page?.comments[0].author.name, "Current name");
  assert.equal(
    page?.comments[0].author.avatarUrl,
    `/api/tracks/${track.id}/comments/${comment.id}/avatar`,
  );
  const { downloadDiscussionAvatar } =
    await import("../../tracks/comment-avatar");
  const bytes = (
    await downloadDiscussionAvatar({
      ...f,
      store,
      id: track.id,
      commentId: comment.id,
    })
  ).bytes;
  assert.equal((await sharp(bytes).metadata()).width, 24);
  await assert.rejects(
    downloadDiscussionAvatar({
      ...f,
      store,
      id: track.id,
      commentId: randomUUID(),
    }),
    { message: "notFound" },
  );
  await assert.rejects(
    downloadDiscussionAvatar({
      ...f,
      store: {
        ...store,
        get: async (key: string) => {
          await f.db
            .update(users)
            .set({ active: false })
            .where(eq(users.id, f.owner.id));
          return data.get(key) ?? null;
        },
      },
      id: track.id,
      commentId: comment.id,
    }),
    { message: "notFound" },
  );
  // Owner deactivation hides the whole track.
  assert.equal(await getTrackComments({ ...f, id: track.id }), null);
});

test("pagination is oldest first with UUID ties, ten parents per page and direct-comment resolution", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  const { trackComments, trackCommentReplies } =
    await import("../../db/schema");
  const ids = Array.from(
    { length: 23 },
    (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  );
  // Deliberately insert reversed UUIDs with tied timestamps.
  const createdAt = new Date("2026-01-01T12:00:00Z");
  await f.db.insert(trackComments).values(
    [...ids].reverse().map((id) => ({
      id,
      trackId: track.id,
      authorId: f.owner.id,
      text: id,
      createdAt,
    })),
  );
  await f.db
    .insert(trackCommentReplies)
    .values({ commentId: ids[10], authorId: f.owner.id, text: "reply" });
  const first = await getTrackComments({ ...f, id: track.id });
  assert.deepEqual(
    first?.comments.map((c) => c.id),
    ids.slice(0, 10),
  );
  assert.equal(first?.total, 23);
  assert.equal(first?.pages, 3);
  const direct = await getTrackComments({
    ...f,
    id: track.id,
    commentId: ids[10],
  });
  assert.equal(direct?.page, 2);
  assert.deepEqual(
    direct?.comments.map((c) => c.id),
    ids.slice(10, 20),
  );
  assert.equal(direct?.comments[0].reply?.text, "reply");
  assert.equal(
    (await getTrackComments({ ...f, id: track.id, page: 3 }))?.comments.length,
    3,
  );
  assert.equal(
    await getTrackComments({ ...f, id: track.id, commentId: randomUUID() }),
    null,
  );
  assert.equal(
    await getTrackComments({ ...f, id: randomUUID(), commentId: ids[10] }),
    null,
  );
  const created = await createTrackComment({
    ...f,
    id: track.id,
    input: { text: "last" },
  });
  assert.equal(created.page, 3);
});

test("posting accepts 2000 Unicode code points, trims text and rejects invalid bodies without consuming throttle", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  for (const input of [
    { text: " " },
    { text: "😀".repeat(2001) },
    { text: "\0" },
    { text: "\ud800" },
    { text: 5 },
    { text: "x", authorId: f.owner.id },
    null,
    [],
  ]) {
    await assert.rejects(createTrackComment({ ...f, id: track.id, input }), {
      message:
        input &&
        !Array.isArray(input) &&
        "text" in input &&
        Object.keys(input).length === 1
          ? "invalidText"
          : "invalidRequest",
    });
  }
  const value = "😀".repeat(2000);
  await createTrackComment({
    ...f,
    id: track.id,
    input: { text: "  " + value + "  " },
  });
  assert.equal(
    (await getTrackComments({ ...f, id: track.id }))?.comments[0].text,
    value,
  );
});

test("guests and unconfirmed/deactivated accounts cannot post; admins gain no owner reply or private access", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  const call = (token: string | undefined = f.token, id = track.id) =>
    createTrackComment({ ...f, token, id, input: { text: "hello" } });
  await assert.rejects(
    createTrackComment({
      ...f,
      token: undefined,
      id: track.id,
      input: { text: "hello" },
    }),
    { message: "unauthorized" },
  );
  assert.equal(
    (await getTrackComments({ ...f, id: track.id }))?.posting,
    "confirmEmail",
  );
  await assert.rejects(call(), { message: "emailUnconfirmed" });
  await f.db
    .update(users)
    .set({ emailConfirmed: true, admin: true })
    .where(eq(users.id, f.owner.id));
  await assert.rejects(call(f.token, randomUUID()), { message: "notFound" });
  const comment = await call();
  const { createOwnerReply } = await import("../../tracks/comments");
  await assert.rejects(
    createOwnerReply({
      ...f,
      id: track.id,
      commentId: comment.id,
      input: { text: "admin" },
    }),
    { message: "forbidden" },
  );
  await f.db
    .update(tracks)
    .set({ visibility: "private" })
    .where(eq(tracks.id, track.id));
  assert.equal(await getTrackComments({ ...f, id: track.id }), null);
  await assert.rejects(call(), { message: "notFound" });
  const ownerToken = (await createSession(f.db, f.other.id)).token;
  assert.equal(
    (await getTrackComments({ ...f, token: ownerToken, id: track.id }))?.total,
    1,
  );
  await f.db
    .update(tracks)
    .set({ visibility: "public" })
    .where(eq(tracks.id, track.id));
  await f.db
    .update(users)
    .set({ active: false })
    .where(eq(users.id, f.owner.id));
  const retained = await getTrackComments({
    ...f,
    token: undefined,
    id: track.id,
  });
  assert.deepEqual(retained?.comments[0].author, {
    name: null,
    deactivated: true,
    avatarUrl: null,
  });
  assert.equal(retained?.comments[0].text, "hello");
  await assert.rejects(call(), { message: "unauthorized" });
  await f.db
    .update(users)
    .set({ active: true, displayName: "Renamed" })
    .where(eq(users.id, f.owner.id));
  assert.equal(
    (await getTrackComments({ ...f, id: track.id }))?.comments[0].author.name,
    "Renamed",
  );
  await f.db
    .update(users)
    .set({ active: false })
    .where(eq(users.id, f.other.id));
  assert.equal(await getTrackComments({ ...f, id: track.id }), null);
  await assert.rejects(call(), { message: "notFound" });
});

test("twenty per rolling hour includes both kinds and deleted posts across tracks", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  const { discussionPostEvents, trackComments } =
    await import("../../db/schema");
  await f.db.insert(discussionPostEvents).values(
    Array.from({ length: 19 }, () => ({
      authorId: f.owner.id,
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
    })),
  );
  const created = await createTrackComment({
    ...f,
    id: track.id,
    input: { text: "twentieth" },
  });
  await f.db.delete(trackComments).where(eq(trackComments.id, created.id));
  await f.db.execute(
    sql`UPDATE discussion_post_events SET created_at=clock_timestamp()-interval '1 minute' WHERE author_id=${f.owner.id}::uuid`,
  );
  await assert.rejects(
    createTrackComment({ ...f, id: track.id, input: { text: "twenty first" } }),
    { message: "rateLimited" },
  );
  await f.db.execute(
    sql`UPDATE discussion_post_events SET created_at=clock_timestamp()-interval '61 minutes' WHERE author_id=${f.owner.id}::uuid`,
  );
  const next = await createTrackComment({
    ...f,
    id: track.id,
    input: { text: "new hour" },
  });
  const another = await addTrack(f);
  await assert.rejects(
    createTrackComment({
      ...f,
      id: another.id,
      input: { text: "other track" },
    }),
    { message: "rateLimited" },
  );
  const { createOwnerReply } = await import("../../tracks/comments");
  await assert.rejects(
    createOwnerReply({
      ...f,
      id: track.id,
      commentId: next.id,
      input: { text: "self reply" },
    }),
    { message: "rateLimited" },
  );
});

test("deleting reply permits replacement; parent/track deletion cascades but retains posting history", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  const { trackComments, trackCommentReplies } =
    await import("../../db/schema");
  const { createOwnerReply } = await import("../../tracks/comments");
  const comment = await createTrackComment({
    ...f,
    id: track.id,
    input: { text: "parent" },
  });
  const release = () =>
    f.db.execute(
      sql`UPDATE discussion_post_events SET created_at=clock_timestamp()-interval '31 seconds' WHERE author_id=${f.owner.id}::uuid`,
    );
  await release();
  const reply = await createOwnerReply({
    ...f,
    id: track.id,
    commentId: comment.id,
    input: { text: "first" },
  });
  await f.db
    .delete(trackCommentReplies)
    .where(eq(trackCommentReplies.id, reply.id));
  assert.equal(
    (await getTrackComments({ ...f, id: track.id }))?.comments[0].canReply,
    true,
  );
  await assert.rejects(
    createOwnerReply({
      ...f,
      id: track.id,
      commentId: comment.id,
      input: { text: "too soon" },
    }),
    { message: "rateLimited" },
  );
  await release();
  await createOwnerReply({
    ...f,
    id: track.id,
    commentId: comment.id,
    input: { text: "replacement" },
  });
  await f.db.delete(trackComments).where(eq(trackComments.id, comment.id));
  assert.equal((await getTrackComments({ ...f, id: track.id }))?.total, 0);
  assert.equal(
    (
      await f.db
        .select()
        .from(trackCommentReplies)
        .where(eq(trackCommentReplies.commentId, comment.id))
    ).length,
    0,
  );
  await release();
  const second = await createTrackComment({
    ...f,
    id: track.id,
    input: { text: "second parent" },
  });
  await release();
  await createOwnerReply({
    ...f,
    id: track.id,
    commentId: second.id,
    input: { text: "second reply" },
  });
  await deleteTrack({ ...f, id: track.id });
  assert.equal(await getTrackComments({ ...f, id: track.id }), null);
  assert.equal(
    (
      await f.db
        .select()
        .from(trackComments)
        .where(eq(trackComments.trackId, track.id))
    ).length,
    0,
  );
  assert.equal(
    (
      await f.db
        .select()
        .from(trackCommentReplies)
        .where(eq(trackCommentReplies.commentId, second.id))
    ).length,
    0,
  );
});

test("schema has safe preference defaults, locale checks, one existing reply and database audit triggers", async (t) => {
  const f = await fixture(t);
  assert.equal(f.owner.discussionEmailsEnabled, true);
  assert.equal(f.owner.discussionEmailLocale, null);
  await assert.rejects(
    f.db.execute(
      sql`UPDATE users SET discussion_email_locale='fr' WHERE id=${f.owner.id}::uuid`,
    ),
  );
  await f.db
    .update(users)
    .set({ discussionEmailLocale: "es", discussionEmailsEnabled: false })
    .where(eq(users.id, f.owner.id));
  const track = await addTrack(f);
  const comment = await createTrackComment({
    ...f,
    id: track.id,
    input: { text: "original" },
  });
  const { trackCommentReplies } = await import("../../db/schema");
  const [reply] = await f.db
    .insert(trackCommentReplies)
    .values({ commentId: comment.id, authorId: f.owner.id, text: "reply" })
    .returning();
  await assert.rejects(
    f.db.insert(trackCommentReplies).values({
      commentId: comment.id,
      authorId: f.owner.id,
      text: "duplicate",
    }),
  );
  for (const table of [
    "track_comments",
    "track_comment_replies",
    "discussion_post_events",
  ]) {
    // Fixture establishes old audit values so the direct-SQL trigger can be observed.
    const row = (
      await f.db.execute<{ id: string; created_at: string }>(
        sql`SELECT id,created_at FROM ${sql.identifier(table)} WHERE author_id=${f.owner.id}::uuid LIMIT 1`,
      )
    ).rows[0];
    const changed = (
      await f.db.execute<{ created_at: string; updated_at: string }>(
        sql`UPDATE ${sql.identifier(table)} SET updated_at='2000-01-01T00:00:00Z' WHERE id=${row.id}::uuid RETURNING created_at,updated_at`,
      )
    ).rows[0];
    assert.equal(
      new Date(changed.created_at).toISOString(),
      new Date(row.created_at).toISOString(),
    );
    assert.ok(
      new Date(changed.updated_at).getTime() > Date.parse("2020-01-01"),
    );
  }
  assert.ok(reply.id);
});

async function waitForBlocker(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      "SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))",
      [pid],
    );
    if (rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error("Comment request did not wait for the expected lock");
}
for (const change of [
  "confirmation",
  "deactivation",
  "privacy",
  "ownerDeactivation",
  "revocation",
] as const) {
  test(`comment rechecks ${change} after an account lock wait`, async (t) => {
    const f = await fixture(t);
    const track = await addTrack(f, f.other.id);
    await f.db
      .update(users)
      .set({ emailConfirmed: true })
      .where(eq(users.id, f.owner.id));
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [[f.owner.id, f.other.id]],
      );
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      const vote = createTrackComment({
        ...f,
        id: track.id,
        input: { text: "locked" },
      });
      // Install rejection handler before releasing the blocked transaction.
      const rejection = assert.rejects(vote, {
        message:
          change === "confirmation"
            ? "emailUnconfirmed"
            : change === "privacy" || change === "ownerDeactivation"
              ? "notFound"
              : "unauthorized",
      });
      await waitForBlocker(pid);
      if (change === "confirmation")
        await blocker.query(
          "UPDATE users SET email_confirmed=false WHERE id=$1",
          [f.owner.id],
        );
      if (change === "deactivation")
        await blocker.query("UPDATE users SET active=false WHERE id=$1", [
          f.owner.id,
        ]);
      if (change === "privacy")
        await blocker.query(
          "UPDATE tracks SET visibility='private' WHERE id=$1",
          [track.id],
        );
      if (change === "ownerDeactivation")
        await blocker.query("UPDATE users SET active=false WHERE id=$1", [
          f.other.id,
        ]);
      if (change === "revocation")
        await blocker.query("DELETE FROM sessions WHERE user_id=$1", [
          f.owner.id,
        ]);
      await blocker.query("COMMIT");
      await rejection;
      const retained = await getTrackComments({
        ...f,
        token: undefined,
        id: track.id,
      });
      assert.equal(retained?.total ?? 0, 0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
}

test("session expiry during a track lock wait rolls back posting", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.owner.id));
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM tracks WHERE id=$1 FOR UPDATE", [
      track.id,
    ]);
    const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0]
      .pid;
    await pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+interval '750 milliseconds' WHERE user_id=$1",
      [f.owner.id],
    );
    const rejected = assert.rejects(
      createTrackComment({ ...f, id: track.id, input: { text: "locked" } }),
      { message: "unauthorized" },
    );
    await waitForBlocker(pid);
    await new Promise((resolve) => setTimeout(resolve, 800));
    await blocker.query("COMMIT");
    await rejected;
    assert.equal(
      (await getTrackComments({ ...f, id: track.id, token: undefined }))?.total,
      0,
    );
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
});

test("concurrent owner replies have one winner; cross-track, nested and missing parents are rejected", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.owner.id));
  const parent = await createTrackComment({
    ...f,
    id: track.id,
    input: { text: "question" },
  });
  const { createOwnerReply } = await import("../../tracks/comments");
  const token = (await createSession(f.db, f.other.id)).token;
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      createOwnerReply({
        ...f,
        token,
        id: track.id,
        commentId: parent.id,
        input: { text: "answer" },
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const result of results)
    if (result.status === "rejected")
      assert.equal(result.reason.message, "replyExists");
  const another = await addTrack(f, f.other.id);
  await assert.rejects(
    createOwnerReply({
      ...f,
      token,
      id: another.id,
      commentId: parent.id,
      input: { text: "wrong track" },
    }),
    { message: "notFound" },
  );
  const { handleCommentsRequest } = await import("../../tracks/comments-http");
  const origin = "http://localhost";
  const response = await handleCommentsRequest(
    new Request(origin + "/api/reply", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: '{"text":"duplicate"}',
    }),
    { ...f, token, origin },
    track.id,
    parent.id,
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "replyExists" });
});

test("private owner can comment and reply; attached ready GPX cannot be made unavailable", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  await f.db
    .update(tracks)
    .set({ visibility: "private" })
    .where(eq(tracks.id, track.id));
  const parent = await createTrackComment({
    ...f,
    id: track.id,
    input: { text: "private" },
  });
  assert.equal(
    await getTrackComments({ ...f, token: undefined, id: track.id }),
    null,
  );
  await f.db.execute(
    sql`UPDATE discussion_post_events SET created_at=clock_timestamp()-interval '31 seconds' WHERE author_id=${f.owner.id}::uuid`,
  );
  const { createOwnerReply } = await import("../../tracks/comments");
  await createOwnerReply({
    ...f,
    id: track.id,
    commentId: parent.id,
    input: { text: "my reply" },
  });
  await assert.rejects(
    f.db.execute(
      sql`UPDATE stored_files SET status='deleting' WHERE id=(SELECT original_file_id FROM tracks WHERE id=${track.id}::uuid)`,
    ),
  );
  assert.equal(
    (await getTrackComments({ ...f, id: track.id }))?.comments[0].reply?.text,
    "my reply",
  );
});

test("concurrent track deletion and posting leave no discussion behind", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.owner.id));
  const { deleteTrack } = await import("../../tracks/service");
  const token = (await createSession(f.db, f.other.id)).token;
  const results = await Promise.allSettled([
    createTrackComment({ ...f, id: track.id, input: { text: "concurrent" } }),
    deleteTrack({ ...f, token, id: track.id }),
  ]);
  assert.equal(results[1].status, "fulfilled");
  if (results[0].status === "rejected")
    assert.equal(results[0].reason.message, "notFound");
  assert.equal(await getTrackComments({ ...f, id: track.id }), null);
  const { trackComments } = await import("../../db/schema");
  assert.equal(
    (
      await f.db
        .select()
        .from(trackComments)
        .where(eq(trackComments.trackId, track.id))
    ).length,
    0,
  );
});

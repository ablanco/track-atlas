import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test, type TestContext } from "node:test";
import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import { users, tracks, storedFiles } from "../../db/schema";
import { signupFixture } from "./auth-helpers";
import { createAcceptedSession } from "../helpers/accepted-session";
import { createTrack } from "../../tracks/service";
import {
  getFollowState,
  setFollowing,
  getFollowing,
} from "../../following/service";
loadEnvConfig(process.cwd(), true);
const url = new URL(process.env.DATABASE_URL!);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  !url.pathname.startsWith("/track_atlas_follow_")
)
  throw Error("Task-owned loopback database required");
const { db, pool } = createDatabase(url.href);
after(() => pool.end());
async function fixture(t: TestContext) {
  const accounts = await db
    .insert(users)
    .values(
      [signupFixture(), signupFixture(), signupFixture()].map((x) => ({
        ...x,
        passwordHash: "synthetic",
      })),
    )
    .returning();
  t.after(async () => {
    for (const u of accounts) {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`DELETE FROM track_upload_attempts WHERE owner_id=${u.id}::uuid`,
        );
        await tx.delete(tracks).where(eq(tracks.ownerId, u.id));
      });
      await db.delete(storedFiles).where(eq(storedFiles.ownerId, u.id));
      await db.delete(users).where(eq(users.id, u.id));
    }
  });
  const [follower, uploader, other] = accounts;
  const token = (await createAcceptedSession(db, follower.id)).token;
  const store = {
    location: "b".repeat(64),
    put: async () => {},
    get: async () => null,
    remove: async () => {},
  };
  async function publish(
    visibility = "public",
    count = 1,
    uploadStore = store,
  ) {
    await db
      .update(users)
      .set({ emailConfirmed: true })
      .where(eq(users.id, uploader.id));
    return createTrack({
      db,
      token: (await createAcceptedSession(db, uploader.id)).token,
      store: uploadStore,
      read: async () => ({
        requestId: randomUUID(),
        input: {
          name: "ridge",
          description: "ridge",
          activity: "hiking",
          difficulty: 3,
          tags: [],
          visibility,
        },
        bytes: Buffer.from(
          `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests">${'<trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.01"/></trkseg></trk>'.repeat(count)}</gpx>`,
        ),
      }),
    });
  }
  return { db, token, follower, uploader, other, publish, store };
}
test("active unconfirmed follower can set desired state concurrently without moving the boundary", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const dep = { db, token: f.token, id: f.uploader.id };
  assert.deepEqual(await getFollowState(dep), {
    following: false,
    eligible: true,
  });
  await Promise.all(
    Array.from({ length: 4 }, () =>
      setFollowing({ ...dep, input: { following: true } }),
    ),
  );
  const first = await getFollowing(f);
  assert.equal(first.total, 1);
  await setFollowing({ ...dep, input: { following: true } });
  assert.deepEqual(await getFollowing(f), first);
  await assert.rejects(
    setFollowing({ ...dep, id: f.follower.id, input: { following: true } }),
    /invalidRequest/,
  );
  await setFollowing({ ...dep, input: { following: false } });
  assert.equal((await getFollowing(f)).total, 0);
});
test("public multi-track creation records one immutable publication instant; private uploads never acquire evidence", async (t) => {
  const f = await fixture(t);
  const made = await f.publish("public", 3);
  const rows = await db.execute<{ at: string | null }>(
    sql`SELECT digest_published_at::text AS at FROM tracks WHERE id IN (${sql.join(
      made.ids.map((id) => sql`${id}::uuid`),
      sql`,`,
    )})`,
  );
  assert.equal(rows.rows.length, 3);
  assert.ok(rows.rows[0].at);
  assert.equal(new Set(rows.rows.map((r) => r.at)).size, 1);
  const privateTrack = await f.publish("private");
  await db.execute(
    sql`UPDATE tracks SET visibility='public' WHERE id=${privateTrack.id}::uuid`,
  );
  assert.equal(
    (
      await db.execute<{ at: null }>(
        sql`SELECT digest_published_at AS at FROM tracks WHERE id=${privateTrack.id}::uuid`,
      )
    ).rows[0].at,
    null,
  );
  await assert.rejects(
    db.execute(
      sql`UPDATE tracks SET digest_published_at=clock_timestamp() WHERE id=${made.id}::uuid`,
    ),
  );
});
test("digest preferences are independent; only explicit reenable revokes old opt-out authority and skips disabled history", async (t) => {
  const f = await fixture(t);
  const { getDigestPreferences, updateDigestPreferences } =
    await import("../../following/preferences");
  assert.deepEqual(await getDigestPreferences(f), {
    enabled: true,
    locale: null,
  });
  await db.execute(
    sql`INSERT INTO digest_opt_out_tokens(recipient_id,token_hash,expires_at) VALUES(${f.follower.id}::uuid,${"a".repeat(64)},clock_timestamp()+interval '90 days')`,
  );
  await updateDigestPreferences({
    ...f,
    input: { enabled: false, locale: "es" },
  });
  const before = (
    await db.execute<{ at: string }>(
      sql`SELECT digest_resume_after::text AS at FROM users WHERE id=${f.follower.id}::uuid`,
    )
  ).rows[0].at;
  assert.ok(before);
  assert.equal(
    (
      await db.execute(
        sql`SELECT id FROM digest_opt_out_tokens WHERE recipient_id=${f.follower.id}::uuid`,
      )
    ).rows.length,
    1,
  );
  await updateDigestPreferences({
    ...f,
    input: { enabled: true, locale: "fr" },
  });
  assert.deepEqual(await getDigestPreferences(f), {
    enabled: true,
    locale: "fr",
  });
  assert.equal(
    (
      await db.execute(
        sql`SELECT id FROM digest_opt_out_tokens WHERE recipient_id=${f.follower.id}::uuid`,
      )
    ).rows.length,
    0,
  );
  const user = (
    await db.select().from(users).where(eq(users.id, f.follower.id))
  )[0];
  assert.equal(user.discussionEmailsEnabled, true);
  assert.equal(user.discussionEmailLocale, null);
  assert.ok(user.digestResumeAfter);
  await assert.rejects(
    updateDigestPreferences({ ...f, input: { enabled: false, locale: "xx" } }),
    /invalidRequest/,
  );
});
test("HTTP adapters enforce session ownership, strict shape, origin, encoding, query and private responses", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const {
    handleFollowRequest,
    handleFollowingRequest,
    handleDigestPreferencesRequest,
  } = await import("../../following/http");
  const origin = "https://localhost:3000";
  const call = (
    method: string,
    body?: string,
    headers: Record<string, string> = {},
    query = "",
  ) =>
    handleFollowRequest(
      new Request(`${origin}/api/users/${f.uploader.id}/follow${query}`, {
        method,
        headers: { origin, "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body }),
      }),
      { ...f, origin },
      f.uploader.id,
    );
  for (const [body, headers, query, status] of [
    ['{"following":true,"userId":"x"}', {}, "", 400],
    ['{"following":1}', {}, "", 400],
    ['{"following":true}', { origin: "https://evil.test" }, "", 403],
    ['{"following":true}', { "sec-fetch-site": "cross-site" }, "", 403],
    ['{"following":true}', { "content-encoding": "gzip" }, "", 400],
    ['{"following":true}', {}, "?x=1", 400],
    [" ".repeat(1025), {}, "", 413],
    ["{", {}, "", 400],
  ] as [string, Record<string, string>, string, number][]) {
    assert.equal((await call("PUT", body, headers, query)).status, status);
  }
  const ok = await call("PUT", '{"following":true}');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  assert.equal((await call("POST", "{}")).status, 405);
  const list = (q: string) =>
    handleFollowingRequest(new Request(`${origin}/api/following${q}`), {
      ...f,
      origin,
    });
  for (const q of ["?follower=x", "?page=0", "?page=1&page=2", "?page=1.5"])
    assert.equal((await list(q)).status, 400);
  const otherToken = (await createAcceptedSession(db, f.other.id)).token;
  const other = await handleFollowingRequest(
    new Request(`${origin}/api/following`),
    { db, token: otherToken, origin },
  );
  assert.equal((await other.json()).total, 0);
  assert.equal(
    (
      await handleFollowingRequest(new Request(`${origin}/api/following`), {
        db,
        token: undefined,
        origin,
      })
    ).status,
    401,
  );
  const prefs = await handleDigestPreferencesRequest(
    new Request(`${origin}/api/digest-preferences`, {
      method: "PUT",
      headers: { origin, "content-type": "application/json" },
      body: '{"enabled":false,"locale":"it"}',
    }),
    { ...f, origin },
  );
  assert.equal(prefs.status, 200);
  assert.deepEqual(await prefs.json(), { enabled: false, locale: "it" });
});
test("following avatars require a current owned edge and recheck session, account and current derivative after I/O", async (t) => {
  const f = await fixture(t);
  await f.publish();
  await setFollowing({ ...f, id: f.uploader.id, input: { following: true } });
  const { createHash } = await import("node:crypto");
  const bytes = Buffer.from("synthetic derivative");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const avatarId = randomUUID();
  const [avatar] = await db
    .insert(storedFiles)
    .values({
      id: avatarId,
      ownerId: f.uploader.id,
      purpose: "avatar",
      status: "ready",
      storageLocation: f.store.location,
      objectKey: avatarId,
      byteSize: bytes.length,
      contentType: "image/webp",
      sha256: hash,
      avatar128Bytes: bytes.length,
      avatar128Sha256: hash,
      avatar24Bytes: bytes.length,
      avatar24Sha256: hash,
    })
    .returning();
  await db
    .update(users)
    .set({ avatarFileId: avatar.id })
    .where(eq(users.id, f.uploader.id));
  const { downloadFollowingAvatar } = await import("../../following/avatar");
  const d = {
    ...f,
    id: f.uploader.id,
    store: { ...f.store, get: async () => bytes },
  };
  assert.deepEqual((await downloadFollowingAvatar(d)).bytes, bytes);
  assert.equal(
    (await getFollowing(f)).items[0].avatarUrl,
    `/api/following/${f.uploader.id}/avatar`,
  );
  await assert.rejects(
    downloadFollowingAvatar({
      ...d,
      token: (await createAcceptedSession(db, f.other.id)).token,
    }),
    /notFound/,
  );
  await assert.rejects(
    downloadFollowingAvatar({
      ...d,
      store: { ...d.store, get: async () => Buffer.from("corrupt") },
    }),
    /unavailable/,
  );
  await assert.rejects(
    downloadFollowingAvatar({
      ...d,
      store: {
        ...d.store,
        get: async () => {
          await setFollowing({
            ...f,
            id: f.uploader.id,
            input: { following: false },
          });
          return bytes;
        },
      },
    }),
    /notFound/,
  );
  await setFollowing({ ...f, id: f.uploader.id, input: { following: true } });
  await assert.rejects(
    downloadFollowingAvatar({
      ...d,
      store: {
        ...d.store,
        get: async () => {
          await db
            .update(users)
            .set({ active: false })
            .where(eq(users.id, f.uploader.id));
          return bytes;
        },
      },
    }),
    /notFound/,
  );
  await db
    .update(users)
    .set({ active: true })
    .where(eq(users.id, f.uploader.id));
  await assert.rejects(
    downloadFollowingAvatar({
      ...d,
      store: {
        ...d.store,
        get: async () => {
          await db
            .update(users)
            .set({ avatarFileId: null })
            .where(eq(users.id, f.uploader.id));
          return bytes;
        },
      },
    }),
    /notFound/,
  );
  await db
    .update(users)
    .set({ avatarFileId: avatar.id })
    .where(eq(users.id, f.uploader.id));
  await assert.rejects(
    downloadFollowingAvatar({
      ...d,
      store: {
        ...d.store,
        get: async () => {
          await db.execute(
            sql`DELETE FROM sessions WHERE user_id=${f.follower.id}::uuid`,
          );
          return bytes;
        },
      },
    }),
    /unauthorized/,
  );
});
test("erasure removes both sides of follows and digest authority in the first withdrawal transaction", async (t) => {
  const f = await fixture(t);
  await f.publish();
  await setFollowing({ ...f, id: f.uploader.id, input: { following: true } });
  const otherToken = (await createAcceptedSession(db, f.other.id)).token;
  await setFollowing({
    ...f,
    token: otherToken,
    id: f.uploader.id,
    input: { following: true },
  });
  await db.execute(
    sql`INSERT INTO digest_deliveries(recipient_id,delivery_day,window_start,window_end) VALUES(${f.uploader.id}::uuid,'2026-11-22','2026-11-21Z','2026-11-22Z')`,
  );
  await db.execute(
    sql`INSERT INTO digest_opt_out_tokens(recipient_id,token_hash,expires_at) VALUES(${f.uploader.id}::uuid,${"b".repeat(64)},clock_timestamp()+interval '90 days')`,
  );
  const { eraseAccount } = await import("../../auth/account-erasure");
  const before = await eraseAccount({
    db,
    userId: f.uploader.id,
    dryRun: true,
    stores: [],
  });
  assert.equal(before.status, "dry-run");
  if (before.status !== "dry-run") throw Error("expected dry run");
  assert.equal(before.follows, 2);
  assert.equal(before.digestDeliveries, 1);
  assert.equal(before.digestTokens, 1);
  const result = await eraseAccount({
    db,
    userId: f.uploader.id,
    confirmation: f.uploader.id,
    stores: [],
  });
  assert.equal(result.status, "pending");
  assert.equal((await getFollowing(f)).total, 0);
  assert.equal(
    (
      await db.execute(
        sql`SELECT id FROM digest_deliveries WHERE recipient_id=${f.uploader.id}::uuid`,
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.execute(
        sql`SELECT id FROM digest_opt_out_tokens WHERE recipient_id=${f.uploader.id}::uuid`,
      )
    ).rows.length,
    0,
  );
});
test("pagination is complete, stable on ties, private and clamps after removal; inactive identities stay removable", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const extras = await db
    .insert(users)
    .values(
      Array.from({ length: 26 }, () => ({
        ...signupFixture(),
        passwordHash: "synthetic",
      })),
    )
    .returning();
  t.after(async () => {
    for (const u of extras) await db.delete(users).where(eq(users.id, u.id));
  });
  // Persistence fixture creates same-clock edges to exercise the documented UUID tie-breaker.
  for (const u of extras)
    await db.execute(
      sql`INSERT INTO uploader_follows(follower_id,uploader_id,followed_at) VALUES(${f.follower.id}::uuid,${u.id}::uuid,'2026-11-20Z')`,
    );
  const p1 = await getFollowing(f),
    p2 = await getFollowing({ ...f, page: 2 });
  assert.equal(p1.items.length, 25);
  assert.equal(p2.items.length, 1);
  assert.equal(p1.total, 26);
  assert.equal(p1.pages, 2);
  const ids = [...p1.items, ...p2.items].map((x) => x.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(new Set(ids).size, 26);
  assert.equal((await getFollowing({ ...f, page: 999 })).page, 2);
  const target = p2.items[0].id;
  await db.update(users).set({ active: false }).where(eq(users.id, target));
  const inactive = (await getFollowing({ ...f, page: 2 })).items[0];
  assert.deepEqual(
    { ...inactive, followedAt: "" },
    {
      id: target,
      active: false,
      displayName: null,
      avatarUrl: null,
      collectionUrl: null,
      followedAt: "",
    },
  );
  await setFollowing({ ...f, id: target, input: { following: false } });
  assert.equal((await getFollowing({ ...f, page: 2 })).page, 1);
  await assert.rejects(
    setFollowing({ ...f, id: target, input: { following: true } }),
    /notFound/,
  );
  await assert.rejects(
    setFollowing({ ...f, id: f.other.id, input: { following: true } }),
    /notFound/,
  );
});
test("session expiry/revocation and uploader deactivation during account lock waits reject without changing edges", async (t) => {
  const f = await fixture(t);
  await f.publish();
  async function blocked(
    change: (client: import("pg").PoolClient) => Promise<unknown>,
  ) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        f.follower.id,
      ]);
      const mutation = setFollowing({
        ...f,
        id: f.uploader.id,
        input: { following: true },
      });
      const observed = mutation.then(
        () => ({ ok: true }),
        () => ({ ok: false }),
      );
      // Inspect PostgreSQL's wait graph, rather than relying on timing of promises.
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        await c.query("SELECT pg_stat_clear_snapshot()");
        const r = await c.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid() AND query LIKE '%ORDER BY id FOR UPDATE%'",
        );
        if (r.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.ok(waiting, "mutation reached account lock");
      await change(c);
      await c.query("COMMIT");
      assert.equal((await observed).ok, false);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }
  await blocked((c) =>
    c.query(
      "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
      [f.follower.id],
    ),
  );
  assert.equal(
    (
      await db.execute(
        sql`SELECT * FROM uploader_follows WHERE follower_id=${f.follower.id}::uuid`,
      )
    ).rows.length,
    0,
  );
  f.token = (await createAcceptedSession(db, f.follower.id)).token;
  await blocked((c) =>
    c.query("UPDATE users SET active=false WHERE id=$1", [f.uploader.id]),
  );
  assert.equal((await getFollowing(f)).total, 0);
});
test("new persistence tables enforce audit triggers, singleton, retry bounds and admin exclusions", async (t) => {
  const f = await fixture(t);
  const tables = [
    "uploader_follows",
    "digest_deliveries",
    "digest_dispatch_days",
    "digest_scheduler_progress",
    "digest_opt_out_tokens",
  ];
  const { adminModels, adminEditableFields } =
    await import("../../admin/models");
  for (const table of tables) {
    assert.ok(!(table in adminModels));
    const audits = await pool.query(
      "SELECT column_name,is_nullable,column_default,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name IN ('created_at','updated_at')",
      [table],
    );
    assert.equal(audits.rows.length, 2);
    for (const c of audits.rows) {
      assert.equal(c.is_nullable, "NO");
      assert.equal(c.data_type, "timestamp with time zone");
      assert.ok(c.column_default);
    }
    const triggers = await pool.query(
      "SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_proc p ON p.oid=g.tgfoid WHERE c.relname=$1 AND p.proname='set_updated_at' AND (g.tgtype & 19)=19",
      [table],
    );
    assert.equal(triggers.rowCount, 1);
  }
  assert.ok(!adminEditableFields.tracks.includes("digest_published_at"));
  await assert.rejects(
    db.execute(
      sql`INSERT INTO uploader_follows(follower_id,uploader_id) VALUES(${f.follower.id}::uuid,${f.follower.id}::uuid)`,
    ),
  );
  await assert.rejects(
    db.execute(sql`INSERT INTO digest_scheduler_progress(id) VALUES(2)`),
  );
  await assert.rejects(
    db.execute(
      sql`INSERT INTO digest_deliveries(recipient_id,delivery_day,window_start,window_end,attempt_count) VALUES(${f.follower.id}::uuid,'2026-11-22','2026-11-21Z','2026-11-22Z',4)`,
    ),
  );
  await assert.rejects(
    db.execute(
      sql`INSERT INTO digest_deliveries(recipient_id,delivery_day,window_start,window_end,state) VALUES(${f.follower.id}::uuid,'2026-11-22','2026-11-21Z','2026-11-22Z','sending')`,
    ),
  );
  const before = (
    await pool.query(
      "SELECT updated_at FROM digest_scheduler_progress WHERE id=1",
    )
  ).rows[0].updated_at;
  await pool.query(
    "UPDATE digest_scheduler_progress SET after_recipient_id=$1 WHERE id=1",
    [f.follower.id],
  );
  assert.ok(
    (
      await pool.query(
        "SELECT updated_at FROM digest_scheduler_progress WHERE id=1",
      )
    ).rows[0].updated_at > before,
  );
  await pool.query(
    "UPDATE digest_scheduler_progress SET after_recipient_id=NULL WHERE id=1",
  );
});
test("refollow establishes a fresh generation and never enables an explicitly disabled digest", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const { updateDigestPreferences, getDigestPreferences } =
    await import("../../following/preferences");
  await updateDigestPreferences({
    ...f,
    input: { enabled: false, locale: "de" },
  });
  const d = { ...f, id: f.uploader.id, input: { following: true } };
  await setFollowing(d);
  const first = (await getFollowing(f)).items[0].followedAt;
  await setFollowing({ ...d, input: { following: false } });
  await setFollowing(d);
  assert.ok((await getFollowing(f)).items[0].followedAt > first);
  assert.deepEqual(await getDigestPreferences(f), {
    enabled: false,
    locale: "de",
  });
  // Losing ordinary public access blocks a new follow but preserves removal authority.
  await db.execute(
    sql`UPDATE tracks SET visibility='private' WHERE owner_id=${f.uploader.id}::uuid`,
  );
  assert.deepEqual(await getFollowState(d), {
    following: true,
    eligible: false,
  });
  await assert.rejects(setFollowing(d), /notFound/);
  assert.equal((await getFollowing(f)).total, 1);
  await setFollowing({ ...d, input: { following: false } });
  assert.equal((await getFollowing(f)).total, 0);
});
test("pending legal acceptance and revoked sessions cannot read or mutate private follow/preferences state", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const { createSession } = await import("../../auth/session-store");
  const token = (await createSession(db, f.other.id)).token;
  const { getDigestPreferences, updateDigestPreferences } =
    await import("../../following/preferences");
  for (const action of [
    () => getFollowing({ ...f, token }),
    () => getFollowState({ ...f, token, id: f.uploader.id }),
    () =>
      setFollowing({
        ...f,
        token,
        id: f.uploader.id,
        input: { following: true },
      }),
    () => getDigestPreferences({ ...f, token }),
    () =>
      updateDigestPreferences({
        ...f,
        token,
        input: { enabled: false, locale: "en" },
      }),
  ])
    await assert.rejects(action(), /unauthorized/);
  await setFollowing({ ...f, id: f.uploader.id, input: { following: true } });
  await db.execute(
    sql`DELETE FROM sessions WHERE user_id=${f.follower.id}::uuid`,
  );
  await assert.rejects(
    setFollowing({ ...f, id: f.uploader.id, input: { following: false } }),
    /unauthorized/,
  );
  const replacement = (await createAcceptedSession(db, f.follower.id)).token;
  assert.equal((await getFollowing({ ...f, token: replacement })).total, 1);
});

test("following during a slow upload precedes its atomic batch publication; refollow excludes the completed batch", async (t) => {
  const f = await fixture(t);
  await f.publish();
  let entered!: () => void, release!: () => void;
  const entering = new Promise<void>((r) => {
    entered = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const publishing = f.publish("public", 2, {
    ...f.store,
    put: async () => {
      entered();
      await gate;
    },
  });
  t.after(() => release());
  await entering;
  await setFollowing({ ...f, id: f.uploader.id, input: { following: true } });
  release();
  const batch = await publishing;
  const eligible = () =>
    db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM tracks t JOIN uploader_follows f ON f.uploader_id=t.owner_id WHERE f.follower_id=${f.follower.id}::uuid AND t.id IN (${sql.join(
        batch.ids.map((id) => sql`${id}::uuid`),
        sql`,`,
      )}) AND t.digest_published_at>=f.followed_at`,
    );
  assert.equal((await eligible()).rows[0].n, 2);
  await setFollowing({ ...f, id: f.uploader.id, input: { following: false } });
  await setFollowing({ ...f, id: f.uploader.id, input: { following: true } });
  assert.equal((await eligible()).rows[0].n, 0);
});

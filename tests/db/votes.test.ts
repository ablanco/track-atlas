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
import { setTrackVote, getTrackVotes } from "../../tracks/votes";
loadEnvConfig(process.cwd(), true);
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
test("requested votes create, switch, withdraw and retry with exact totals and negative popularity", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.owner.id));
  const empty = await getTrackVotes({ ...f, id: track.id });
  assert.deepEqual([empty?.up, empty?.down, empty?.popularity], [0, 0, 0]);
  const vote = (state: "up" | "down" | null) =>
    setTrackVote({ ...f, id: track.id, input: { vote: state } });
  for (const [state, expected] of [
    ["up", [1, 0, 1]],
    ["up", [1, 0, 1]],
    ["down", [0, 1, -1]],
    ["up", [1, 0, 1]],
    [null, [0, 0, 0]],
    [null, [0, 0, 0]],
  ] as const) {
    const result = await vote(state);
    assert.deepEqual([result.up, result.down, result.popularity], expected);
    assert.equal(result.vote, state);
    assert.deepEqual(await getTrackVotes({ ...f, id: track.id }), result);
  }
});

test("voting rejects guests, owners, unconfirmed/deactivated users, private and missing tracks and forged voter inputs", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  const ownerToken = (await createSession(f.db, f.other.id)).token;
  const call = (
    token: string | undefined,
    input: unknown = { vote: "up" },
    id = track.id,
  ) => setTrackVote({ ...f, token, id, input });
  await assert.rejects(call(undefined), { message: "unauthorized" });
  await assert.rejects(call(ownerToken), { message: "forbidden" });
  await assert.rejects(call(f.token), { message: "emailUnconfirmed" });
  await assert.rejects(call(f.token, { vote: "up", voterId: f.other.id }), {
    message: "invalidRequest",
  });
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.owner.id));
  await assert.rejects(call(f.token, { vote: "invalid" }), {
    message: "invalidRequest",
  });
  await assert.rejects(call(f.token, { vote: "up" }, randomUUID()), {
    message: "notFound",
  });
  await f.db
    .update(tracks)
    .set({ visibility: "private" })
    .where(eq(tracks.id, track.id));
  await assert.rejects(call(f.token), { message: "notFound" });
  assert.equal(await getTrackVotes({ ...f, id: track.id }), null);
  await f.db
    .update(tracks)
    .set({ visibility: "public" })
    .where(eq(tracks.id, track.id));
  await f.db
    .update(users)
    .set({ active: false })
    .where(eq(users.id, f.owner.id));
  await assert.rejects(call(f.token), { message: "unauthorized" });
  await f.db
    .update(users)
    .set({ active: true })
    .where(eq(users.id, f.owner.id));
  await f.db
    .update(users)
    .set({ active: false })
    .where(eq(users.id, f.other.id));
  await assert.rejects(call(f.token), { message: "notFound" });
});

test("concurrent requests remain exact; privacy and voter deactivation retain totals, track deletion cascades", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.owner.id));
  await Promise.all(
    Array.from({ length: 12 }, () =>
      setTrackVote({ ...f, id: track.id, input: { vote: "down" } }),
    ),
  );
  assert.deepEqual(await getTrackVotes({ ...f, id: track.id }), {
    up: 0,
    down: 1,
    popularity: -1,
    vote: "down",
    canVote: true,
    needsConfirmation: false,
  });
  await Promise.all(
    Array.from({ length: 12 }, (_, n) =>
      setTrackVote({
        ...f,
        id: track.id,
        input: { vote: n % 2 ? "up" : "down" },
      }),
    ),
  );
  const result = await getTrackVotes({ ...f, id: track.id });
  assert.ok(result);
  assert.equal(result.up + result.down, 1);
  assert.equal(result.popularity, result.up - result.down);
  await f.db
    .update(tracks)
    .set({ visibility: "private" })
    .where(eq(tracks.id, track.id));
  const ownerToken = (await createSession(f.db, f.other.id)).token;
  const retained = await getTrackVotes({
    ...f,
    id: track.id,
    token: ownerToken,
  });
  assert.equal(retained?.popularity, result.popularity);
  assert.equal(retained?.canVote, false);
  await f.db
    .update(users)
    .set({ active: false })
    .where(eq(users.id, f.owner.id));
  await f.db
    .update(tracks)
    .set({ visibility: "public" })
    .where(eq(tracks.id, track.id));
  assert.equal(
    (await getTrackVotes({ ...f, id: track.id, token: undefined }))?.popularity,
    result.popularity,
  );
  await deleteTrack({ ...f, token: ownerToken, id: track.id });
  assert.equal(await getTrackVotes({ ...f, id: track.id }), null);
  assert.equal(
    (
      await f.db.execute(
        sql`SELECT count(*)::int AS n FROM track_votes WHERE track_id=${track.id}::uuid`,
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(
    setTrackVote({
      ...f,
      token: ownerToken,
      id: track.id,
      input: { vote: "up" },
    }),
    { message: "notFound" },
  );
});

test("vote HTTP boundary validates origin and explicit input, keeps responses private and never accepts voter identity", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.owner.id));
  const { handleVoteRequest } = await import("../../tracks/votes-http");
  const origin = "http://localhost";
  const request = (input: unknown, headers: Record<string, string> = {}) =>
    new Request(`${origin}/api/tracks/${track.id}/vote`, {
      method: "PUT",
      headers: { origin, "content-type": "application/json", ...headers },
      body: JSON.stringify(input),
    });
  const call = (input: unknown, headers?: Record<string, string>) =>
    handleVoteRequest(request(input, headers), { ...f, origin }, track.id);
  assert.equal(
    (await call({ vote: "up" }, { origin: "http://evil.test" })).status,
    403,
  );
  assert.equal((await call({ vote: "up", voterId: f.other.id })).status, 400);
  const response = await call({ vote: "up" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).vote, "up");
});

test("administrators inspect vote records and popularity but cannot mutate either", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  await f.db
    .update(users)
    .set({ emailConfirmed: true, admin: true })
    .where(eq(users.id, f.owner.id));
  await setTrackVote({ ...f, id: track.id, input: { vote: "up" } });
  const { listAdminRecords, getAdminRecord } =
    await import("../../admin/queries");
  const { mutateAdminRecords } = await import("../../admin/mutations");
  const page = await listAdminRecords(
    f.db,
    f.token,
    "track_votes",
    new URLSearchParams({ track_id: track.id }),
  );
  assert.equal(page.total, 1);
  assert.equal(page.rows[0].selectable, false);
  assert.equal(page.rows[0].values.direction, 1);
  assert.ok(
    page.rows[0].related.some(
      (x) => x.field === "voter_id" && x.model === "users",
    ),
  );
  const detail = await getAdminRecord(
    f.db,
    f.token,
    "tracks",
    JSON.stringify([track.id]),
  );
  assert.equal(detail.record.values.popularity, 1);
  for (const operation of ["update", "delete", "revoke"])
    await assert.rejects(
      mutateAdminRecords(f.db, f.token, {
        model: "track_votes",
        operation,
        ids: [page.rows[0].id],
        ...(operation === "update" ? { values: { direction: -1 } } : {}),
      }),
      { message: "invalidRequest" },
    );
  await assert.rejects(
    mutateAdminRecords(f.db, f.token, {
      model: "tracks",
      operation: "update",
      ids: [JSON.stringify([track.id])],
      values: { popularity: 55 },
    }),
    { message: "invalidRequest" },
  );
});

test("independent voters mutate concurrently without losing totals", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  const voters = await f.db
    .insert(users)
    .values(
      Array.from({ length: 6 }, () => ({
        ...signupFixture(),
        passwordHash: "synthetic",
        emailConfirmed: true,
      })),
    )
    .returning();
  t.after(async () => {
    for (const voter of voters)
      await f.db.delete(users).where(eq(users.id, voter.id));
  });
  const tokens = await Promise.all(
    voters.map(async (voter) => (await createSession(f.db, voter.id)).token),
  );
  const cast = (token: string, vote: "up" | "down" | null) =>
    setTrackVote({ ...f, token, id: track.id, input: { vote } });
  await Promise.all(tokens.map((token) => cast(token, "up")));
  await Promise.all(
    tokens.flatMap((token, n) => [
      cast(token, n < 3 ? "down" : n === 3 ? null : "up"),
      cast(token, n < 3 ? "down" : n === 3 ? null : "up"),
    ]),
  );
  const result = await getTrackVotes({ ...f, token: undefined, id: track.id });
  assert.equal(result?.up, 2);
  assert.equal(result?.down, 3);
  assert.equal(result?.popularity, -1);
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
  throw Error("Vote request did not wait for the expected lock");
}
for (const change of [
  "confirmation",
  "deactivation",
  "privacy",
  "ownerDeactivation",
  "revocation",
] as const) {
  test(`vote rechecks ${change} after an account lock wait`, async (t) => {
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
      const vote = setTrackVote({ ...f, id: track.id, input: { vote: "up" } });
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
      const retained = await f.db.execute(
        sql`SELECT popularity FROM tracks WHERE id=${track.id}::uuid`,
      );
      assert.equal(retained.rows[0].popularity, 0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
}

test("session expiry during a track lock wait rolls back voting", async (t) => {
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
      setTrackVote({ ...f, id: track.id, input: { vote: "up" } }),
      { message: "unauthorized" },
    );
    await waitForBlocker(pid);
    await new Promise((resolve) => setTimeout(resolve, 800));
    await blocker.query("COMMIT");
    await rejected;
    assert.equal(
      (await getTrackVotes({ ...f, id: track.id, token: undefined }))
        ?.popularity,
      0,
    );
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
});

test("concurrent track deletion and votes leave no votes or ranking behind", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  await f.db
    .update(users)
    .set({ emailConfirmed: true })
    .where(eq(users.id, f.owner.id));
  const { deleteTrack } = await import("../../tracks/service");
  const ownerToken = (await createSession(f.db, f.other.id)).token;
  const votes = Array.from({ length: 8 }, (_, n) =>
    setTrackVote({
      ...f,
      id: track.id,
      input: { vote: n % 2 ? "up" : "down" },
    }),
  );
  const results = await Promise.allSettled([
    ...votes,
    deleteTrack({ ...f, id: track.id, token: ownerToken }),
  ]);
  assert.equal(results.at(-1)?.status, "fulfilled");
  for (const result of results)
    if (result.status === "rejected")
      assert.equal(result.reason.message, "notFound");
  assert.equal(await getTrackVotes({ ...f, id: track.id }), null);
  const retained = await f.db.execute(
    sql`SELECT count(*)::int AS n FROM track_votes WHERE track_id=${track.id}::uuid`,
  );
  assert.equal(retained.rows[0].n, 0);
});

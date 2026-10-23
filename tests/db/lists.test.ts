import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test, type TestContext } from "node:test";
import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";
import { users, tracks, storedFiles } from "../../db/schema";
import { createSession, revokeSession } from "../../auth/session-store";
import { signupFixture } from "./auth-helpers";
import {
  createTrackList,
  getTrackList,
  setTrackListMembership,
  getTrackListPicker,
  getTrackLists,
  renameTrackList,
  deleteTrackList,
} from "../../tracks/lists";
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
test("active unconfirmed users can create and retrieve trimmed private lists with normalized unique names", async (t) => {
  const f = await fixture(t);
  const list = await createTrackList({ ...f, input: { name: "  Peña  " } });
  assert.equal(list.name, "Peña");
  assert.equal(list.trackCount, 0);
  assert.deepEqual(await getTrackList({ ...f, id: list.id }), list);
  await assert.rejects(
    createTrackList({ ...f, input: { name: "PEN\u0303A" } }),
    {
      message: "duplicateName",
    },
  );
  assert.equal(
    await getTrackList({
      ...f,
      token: (await createSession(f.db, f.other.id)).token,
      id: list.id,
    }),
    null,
  );
  await assert.rejects(getTrackList({ ...f, token: undefined, id: list.id }), {
    message: "unauthorized",
  });
});

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
test("create-and-add is atomic, membership writes are idempotent and inaccessible memberships remain removable", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  const list = await createTrackList({
    ...f,
    input: { name: "Walks", trackId: track.id },
  });
  assert.equal(list.trackCount, 1);
  await setTrackListMembership({
    ...f,
    id: list.id,
    trackId: track.id,
    present: true,
  });
  assert.equal(
    (await getTrackListPicker({ ...f, trackId: track.id })).lists[0]
      .containsTrack,
    true,
  );
  await f.db
    .update(tracks)
    .set({ visibility: "private" })
    .where(eq(tracks.id, track.id));
  assert.equal((await getTrackList({ ...f, id: list.id }))?.trackCount, 0);
  await assert.rejects(
    createTrackList({ ...f, input: { name: "Failed", trackId: track.id } }),
    { message: "notFound" },
  );
  await f.db
    .update(tracks)
    .set({ visibility: "public" })
    .where(eq(tracks.id, track.id));
  assert.equal((await getTrackList({ ...f, id: list.id }))?.trackCount, 1);
  assert.equal(
    (await getTrackListPicker({ ...f, trackId: track.id })).lists.length,
    1,
  );
  await f.db
    .update(tracks)
    .set({ visibility: "private" })
    .where(eq(tracks.id, track.id));
  await setTrackListMembership({
    ...f,
    id: list.id,
    trackId: track.id,
    present: false,
  });
  await setTrackListMembership({
    ...f,
    id: list.id,
    trackId: track.id,
    present: false,
  });
  await f.db
    .update(tracks)
    .set({ visibility: "public" })
    .where(eq(tracks.id, track.id));
  assert.equal(
    (await getTrackListPicker({ ...f, trackId: track.id })).lists[0]
      .containsTrack,
    false,
  );
});

test("list management validates names, paginates and clamps, preserves creation order and caps concurrent creates", async (t) => {
  const f = await fixture(t);
  for (const name of ["", "  ", "x".repeat(101)])
    await assert.rejects(createTrackList({ ...f, input: { name } }), {
      message: "invalidRequest",
    });
  const first = await createTrackList({ ...f, input: { name: "First" } });
  const second = await createTrackList({ ...f, input: { name: "Second" } });
  await renameTrackList({ ...f, id: first.id, input: { name: "Renamed" } });
  assert.deepEqual(
    (await getTrackLists({ ...f, page: 99 })).lists.map((l) => l.name),
    ["Second", "Renamed"],
  );
  await assert.rejects(
    renameTrackList({ ...f, id: first.id, input: { name: "SECOND" } }),
    { message: "duplicateName" },
  );
  const foreign = (await createSession(f.db, f.other.id)).token;
  await assert.rejects(
    deleteTrackList({ ...f, token: foreign, id: first.id }),
    { message: "notFound" },
  );
  for (let n = 2; n < 99; n++)
    await createTrackList({ ...f, input: { name: `List ${n}` } });
  const outcomes = await Promise.allSettled([
    createTrackList({ ...f, input: { name: "Last A" } }),
    createTrackList({ ...f, input: { name: "Last B" } }),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (outcomes.find((x) => x.status === "rejected") as PromiseRejectedResult)
      .reason.message,
    "listLimit",
  );
  const last = await getTrackLists({ ...f, page: 999 });
  assert.equal(last.total, 100);
  assert.equal(last.page, 5);
  assert.equal(last.lists.length, 20);
  await deleteTrackList({ ...f, id: second.id });
  assert.equal(await getTrackList({ ...f, id: second.id }), null);
  await revokeSession(f.db, f.token);
  await assert.rejects(getTrackLists(f), { message: "unauthorized" });
  await assert.rejects(
    renameTrackList({ ...f, id: first.id, input: { name: "Unauthorized" } }),
    { message: "unauthorized" },
  );
});

test("list exploration uses mixed-owner access, membership ordering, scoped bounds and bookmark state", async (t) => {
  const f = await fixture(t);
  const own = await addTrack(f);
  const other = await addTrack(f, f.other.id);
  const { getExploreResults } = await import("../../tracks/explore");
  const { parseExploreFilters } = await import("../../tracks/explore-query");
  const list = await createTrackList({
    ...f,
    input: { name: "Mixed", trackId: own.id },
  });
  await setTrackListMembership({
    ...f,
    id: list.id,
    trackId: other.id,
    present: true,
  });
  await f.db
    .update(tracks)
    .set({ visibility: "private" })
    .where(eq(tracks.id, own.id));
  const read = (
    query = "",
    token: string | undefined = f.token,
    id = list.id,
  ) =>
    getExploreResults({
      db: f.db,
      token,
      listId: id,
      filters: parseExploreFilters(new URLSearchParams(query)),
    });
  await f.db
    .update(tracks)
    .set({ distanceMeters: 999999 })
    .where(eq(tracks.id, other.id));
  const all = await read();
  assert.equal(all?.collection, null);
  assert.deepEqual(all?.list, { id: list.id, name: "Mixed" });
  assert.deepEqual(
    all?.tracks.map((x) => x.id),
    [other.id, own.id],
  );
  assert.ok(all?.tracks.every((x) => x.isBookmarked));
  assert.deepEqual(
    (await read("visibility=private"))?.tracks.map((x) => x.id),
    [own.id],
  );
  assert.equal((await read("visibility=public"))?.total, 1);
  await f.db
    .update(tracks)
    .set({ visibility: "private" })
    .where(eq(tracks.id, other.id));
  assert.equal((await read())?.scopeCount, 1);
  assert.ok((await read())!.bounds.maxDistanceKm < 999);
  assert.equal((await getTrackList({ ...f, id: list.id }))?.trackCount, 1);
  await f.db
    .update(users)
    .set({ active: false })
    .where(eq(users.id, f.other.id));
  await f.db
    .update(tracks)
    .set({ visibility: "public" })
    .where(eq(tracks.id, other.id));
  assert.equal((await read())?.scopeCount, 1);
  await f.db
    .update(users)
    .set({ active: true })
    .where(eq(users.id, f.other.id));
  assert.equal((await read())?.scopeCount, 2);
  assert.equal((await read())?.bounds.maxDistanceKm, 999.999);
  await setTrackListMembership({
    ...f,
    id: list.id,
    trackId: own.id,
    present: false,
  });
  await setTrackListMembership({
    ...f,
    id: list.id,
    trackId: own.id,
    present: true,
  });
  assert.deepEqual(
    (await read())?.tracks.map((x) => x.id),
    [own.id, other.id],
  );
  assert.equal(
    await read("", (await createSession(f.db, f.other.id)).token),
    null,
  );
  await assert.rejects(
    getExploreResults({
      db: f.db,
      token: undefined,
      listId: list.id,
      filters: parseExploreFilters(new URLSearchParams()),
    }),
    { message: "unauthorized" },
  );
  assert.equal(await read("", f.token, randomUUID()), null);
  await assert.rejects(
    getExploreResults({
      ...f,
      ownerId: f.owner.id,
      listId: list.id,
      filters: parseExploreFilters(new URLSearchParams()),
    }),
    { message: "invalidRequest" },
  );
});

test("HTTP list endpoints validate requests and keep every response private", async (t) => {
  const f = await fixture(t);
  const { handleListRequest } = await import("../../tracks/lists-http");
  const origin = "http://localhost";
  const deps = { ...f, origin };
  const call = (
    method: string,
    path = "",
    input?: unknown,
    overrides: Record<string, string> = {},
  ) =>
    handleListRequest(
      new Request(`${origin}/api/lists${path}`, {
        method,
        headers: { origin, "content-type": "application/json", ...overrides },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      }),
      deps,
    );
  let res = await call("POST", "", { name: "HTTP" });
  assert.equal(res.status, 201);
  const { list } = await res.json();
  for (const [method, path, input, status] of [
    ["GET", "", undefined, 200],
    ["GET", `/${list.id}`, undefined, 200],
    ["PATCH", `/${list.id}`, { name: "Renamed" }, 200],
    ["GET", "?unknown=x", undefined, 400],
    ["GET", "?page=1&page=2", undefined, 400],
    ["GET", `?page=1&trackId=${randomUUID()}`, undefined, 400],
    ["POST", "", { name: "x", userId: f.other.id }, 400],
    ["POST", "", { name: "x" }, 201],
    ["POST", "", { name: "X" }, 409],
    ["DELETE", `/${list.id}?x=1`, undefined, 400],
    ["PUT", `/${list.id}/tracks/${randomUUID()}`, {}, 400],
    ["DELETE", `/${list.id}`, undefined, 204],
    ["GET", `/${list.id}`, undefined, 404],
  ] as const) {
    res = await call(method, path, input);
    assert.equal(res.status, status, `${method} ${path}`);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  }
  assert.equal(
    (await call("POST", "", { name: "bad" }, { origin: "https://evil.test" }))
      .status,
    400,
  );
  const guest = await handleListRequest(new Request(`${origin}/api/lists`), {
    ...deps,
    token: undefined,
  });
  assert.equal(guest.status, 401);
});

test("explorer HTTP rejects guest/foreign list scopes and never falls back to public search", async (t) => {
  const f = await fixture(t);
  const list = await createTrackList({ ...f, input: { name: "Scope" } });
  const { handleExploreRequest } = await import("../../tracks/explore-http");
  const call = (query: string, token: string | undefined) =>
    handleExploreRequest(
      new Request(`http://localhost/api/tracks/explore?${query}`),
      { db: f.db, token },
    );
  assert.equal((await call(`listId=${list.id}`, f.token)).status, 200);
  const guest = await call(`listId=${list.id}`, undefined);
  assert.equal(guest.status, 401);
  assert.deepEqual(await guest.json(), { error: "unauthorized" });
  assert.equal(
    (
      await call(
        `listId=${list.id}`,
        (await createSession(f.db, f.other.id)).token,
      )
    ).status,
    404,
  );
  for (const query of [
    `listId=${list.id}&ownerId=${f.owner.id}`,
    `listId=${list.id}&listId=${list.id}`,
    "listId=bad",
  ])
    assert.equal((await call(query, f.token)).status, 400);
});

test("membership capacity includes inaccessible tracks, concurrent final-slot adds serialize, and retries still succeed", async (t) => {
  const f = await fixture(t);
  const original = await addTrack(f, f.other.id);
  const list = await createTrackList({ ...f, input: { name: "Capacity" } });
  // Committed, complete synthetic tracks: fixture setup only. All assertions use services.
  const ids = await f.db.transaction(async (tx) => {
    const files = await tx.execute<{ id: string }>(
      sql`INSERT INTO stored_files SELECT (jsonb_populate_record(NULL::stored_files,to_jsonb(f)||jsonb_build_object('id',n.id,'object_key',n.id::text))).* FROM stored_files f CROSS JOIN (SELECT gen_random_uuid() AS id FROM generate_series(1,1001)) n WHERE f.id=(SELECT original_file_id FROM tracks WHERE id=${original.id}::uuid) RETURNING id`,
    );
    const trackIds: string[] = [];
    for (const file of files.rows) {
      const copied = await tx.execute<{ id: string }>(
        sql`INSERT INTO tracks SELECT (jsonb_populate_record(NULL::tracks,to_jsonb(t)||jsonb_build_object('id',gen_random_uuid(),'original_file_id',${file.id}::uuid,'request_id',gen_random_uuid()))).* FROM tracks t WHERE t.id=${original.id}::uuid RETURNING id`,
      );
      trackIds.push(copied.rows[0].id);
    }
    await tx.execute(
      sql`INSERT INTO track_data SELECT (jsonb_populate_record(NULL::track_data,to_jsonb(d)||jsonb_build_object('track_id',ids.id))).* FROM track_data d CROSS JOIN unnest(${"{" + trackIds.join(",") + "}"}::uuid[]) ids(id) WHERE d.track_id=${original.id}::uuid`,
    );
    await tx.execute(
      sql`INSERT INTO track_directional_representations SELECT (jsonb_populate_record(NULL::track_directional_representations,to_jsonb(d)||jsonb_build_object('track_id',ids.id))).* FROM track_directional_representations d CROSS JOIN unnest(${"{" + trackIds.join(",") + "}"}::uuid[]) ids(id) WHERE d.track_id=${original.id}::uuid`,
    );
    await tx.execute(
      sql`INSERT INTO track_upload_attempts SELECT a.owner_id,t.request_id,a.fingerprint,t.original_file_id,t.id,'complete',now(),now() FROM tracks t CROSS JOIN track_upload_attempts a WHERE t.id=ANY(${"{" + trackIds.join(",") + "}"}::uuid[]) AND a.track_id=${original.id}::uuid`,
    );
    await tx.execute(
      sql`INSERT INTO track_list_memberships(list_id,track_id) SELECT ${list.id}::uuid,id FROM unnest(${"{" + trackIds.slice(0, 999).join(",") + "}"}::uuid[]) ids(id)`,
    );
    return trackIds;
  });
  await f.db
    .update(tracks)
    .set({ visibility: "private" })
    .where(eq(tracks.id, ids[0]));
  const results = await Promise.allSettled(
    ids
      .slice(999)
      .map((trackId) =>
        setTrackListMembership({ ...f, id: list.id, trackId, present: true }),
      ),
  );
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (results.find((x) => x.status === "rejected") as PromiseRejectedResult)
      .reason.message,
    "trackLimit",
  );
  await setTrackListMembership({
    ...f,
    id: list.id,
    trackId: ids[1],
    present: true,
  });
  assert.equal((await getTrackList({ ...f, id: list.id }))?.trackCount, 999);
  await setTrackListMembership({
    ...f,
    id: list.id,
    trackId: ids[1],
    present: false,
  });
  await setTrackListMembership({
    ...f,
    id: list.id,
    trackId: original.id,
    present: true,
  });
  assert.equal((await getTrackList({ ...f, id: list.id }))?.trackCount, 999);
  const { deleteTrack } = await import("../../tracks/service");
  await deleteTrack({
    db: f.db,
    token: (await createSession(f.db, f.other.id)).token,
    id: ids[0],
  });
  const blockedId = ids[999 + (results[0].status === "fulfilled" ? 1 : 0)];
  await setTrackListMembership({
    ...f,
    id: list.id,
    trackId: blockedId,
    present: true,
  });
  assert.equal((await getTrackList({ ...f, id: list.id }))?.trackCount, 1000);
  const small = await createTrackList({ ...f, input: { name: "Paging" } });
  for (const trackId of ids.slice(1, 12))
    await setTrackListMembership({
      ...f,
      id: small.id,
      trackId,
      present: true,
    });
  const { getExploreResults } = await import("../../tracks/explore");
  const { parseExploreFilters } = await import("../../tracks/explore-query");
  const page = () =>
    getExploreResults({
      ...f,
      listId: small.id,
      filters: parseExploreFilters(new URLSearchParams("page=999")),
    });
  assert.equal((await page())?.page, 2);
  await setTrackListMembership({
    ...f,
    id: small.id,
    trackId: ids[1],
    present: false,
  });
  assert.equal((await page())?.page, 1);
  assert.equal((await page())?.total, 10);
});

test("membership mutation rejects a session that expires while waiting for its session lock", async (t) => {
  const f = await fixture(t);
  const list = await createTrackList({ ...f, input: { name: "Expiry" } });
  const client = await pool.connect();
  let pending: Promise<void> | undefined;
  try {
    await client.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE user_id=$1",
      [f.owner.id],
    );
    await client.query("BEGIN");
    await client.query("SELECT id FROM sessions WHERE user_id=$1 FOR UPDATE", [
      f.owner.id,
    ]);
    const {
      rows: [{ pid }],
    } = await client.query("SELECT pg_backend_pid() AS pid");
    pending = setTrackListMembership({
      ...f,
      id: list.id,
      trackId: randomUUID(),
      present: false,
    });
    const outcome = assert.rejects(pending, { message: "unauthorized" });
    let waiting = false;
    for (let n = 0; n < 100; n++) {
      const check = await pool.query(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting",
        [pid],
      );
      if (check.rows[0].waiting) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true, "mutation reached the held session lock");
    await client.query("SELECT pg_sleep(1.1)");
    await client.query("COMMIT");
    await outcome;
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pending?.catch(() => {});
  }
});

for (const kind of ["revoked", "expired", "disabled"] as const)
  test(`list mutations reauthorize ${kind} accounts after waiting for the user lock`, async (t) => {
    const f = await fixture(t);
    const list = await createTrackList({ ...f, input: { name: "Original" } });
    const client = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        f.owner.id,
      ]);
      const {
        rows: [{ pid }],
      } = await client.query("SELECT pg_backend_pid() AS pid");
      pending = renameTrackList({
        ...f,
        id: list.id,
        input: { name: "Rejected" },
      });
      const outcome = assert.rejects(pending, { message: "unauthorized" });
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const check = await pool.query(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting",
          [pid],
        );
        if (check.rows[0].waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true);
      if (kind === "revoked")
        await client.query("DELETE FROM sessions WHERE user_id=$1", [
          f.owner.id,
        ]);
      if (kind === "expired")
        await client.query(
          "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
          [f.owner.id],
        );
      if (kind === "disabled")
        await client.query("UPDATE users SET active=false WHERE id=$1", [
          f.owner.id,
        ]);
      await client.query("COMMIT");
      await outcome;
      await assert.rejects(getTrackList({ ...f, id: list.id }), {
        message: "unauthorized",
      });
      await f.db
        .update(users)
        .set({ active: true })
        .where(eq(users.id, f.owner.id));
      assert.equal(
        (
          await getTrackList({
            ...f,
            token: (await createSession(f.db, f.owner.id)).token,
            id: list.id,
          })
        )?.name,
        "Original",
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pending?.catch(() => {});
    }
  });

test("HTTP membership retries, picker access and bookmark state follow the current session", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f, f.other.id);
  const { handleListRequest } = await import("../../tracks/lists-http");
  const { handleExploreRequest } = await import("../../tracks/explore-http");
  const origin = "http://localhost",
    deps = { db: f.db, token: f.token, origin };
  const list = await createTrackList({
    ...f,
    input: { name: "HTTP memberships" },
  });
  const path = `${origin}/api/lists/${list.id}/tracks/${track.id}`;
  const request = (method: string) =>
    new Request(path, { method, headers: { origin } });
  for (let n = 0; n < 2; n++)
    assert.equal((await handleListRequest(request("PUT"), deps)).status, 204);
  const picker = await handleListRequest(
    new Request(`${origin}/api/lists?trackId=${track.id}`),
    deps,
  );
  assert.equal((await picker.json()).lists[0].containsTrack, true);
  const explore = () =>
    handleExploreRequest(
      new Request(`${origin}/api/tracks/explore?ownerId=${f.other.id}`),
      deps,
    );
  assert.equal((await (await explore()).json()).tracks[0].isBookmarked, true);
  const foreignToken = (await createSession(f.db, f.other.id)).token;
  assert.equal(
    (
      await handleListRequest(request("DELETE"), {
        ...deps,
        token: foreignToken,
      })
    ).status,
    404,
  );
  await f.db
    .update(tracks)
    .set({ visibility: "private" })
    .where(eq(tracks.id, track.id));
  assert.equal(
    (
      await handleListRequest(
        new Request(`${origin}/api/lists?trackId=${track.id}`),
        deps,
      )
    ).status,
    404,
  );
  assert.equal((await handleListRequest(request("PUT"), deps)).status, 404);
  for (let n = 0; n < 2; n++)
    assert.equal(
      (await handleListRequest(request("DELETE"), deps)).status,
      204,
    );
  await f.db
    .update(tracks)
    .set({ visibility: "public" })
    .where(eq(tracks.id, track.id));
  assert.equal((await (await explore()).json()).tracks[0].isBookmarked, false);
  await revokeSession(f.db, f.token);
  assert.equal((await handleListRequest(request("PUT"), deps)).status, 401);
  for (const [body, headers] of [
    ["{", { "content-type": "application/json" }],
    ["x".repeat(33000), { "content-type": "application/json" }],
    ["{}", { "content-type": "text/plain" }],
    ["{}", { "content-type": "application/json", "content-encoding": "gzip" }],
  ] as const) {
    const response = await handleListRequest(
      new Request(`${origin}/api/lists`, {
        method: "POST",
        headers: { origin, ...headers },
        body,
      }),
      { ...deps, token: foreignToken },
    );
    assert.equal(response.status, 400);
  }
});

test("list deletion rolls back when the session expires during the list lock wait", async (t) => {
  const f = await fixture(t);
  const list = await createTrackList({
    ...f,
    input: { name: "List lock expiry" },
  });
  const client = await pool.connect();
  let pending: Promise<void> | undefined;
  try {
    await client.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE user_id=$1",
      [f.owner.id],
    );
    await client.query("BEGIN");
    await client.query("SELECT id FROM track_lists WHERE id=$1 FOR UPDATE", [
      list.id,
    ]);
    const {
      rows: [{ pid }],
    } = await client.query("SELECT pg_backend_pid() AS pid");
    pending = deleteTrackList({ ...f, id: list.id });
    const outcome = assert.rejects(pending, { message: "unauthorized" });
    let waiting = false;
    for (let n = 0; n < 100; n++) {
      const check = await pool.query(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting",
        [pid],
      );
      if (check.rows[0].waiting) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true);
    await client.query("SELECT pg_sleep(1.1)");
    await client.query("COMMIT");
    await outcome;
    assert.equal(
      (
        await getTrackList({
          ...f,
          id: list.id,
          token: (await createSession(f.db, f.owner.id)).token,
        })
      )?.name,
      "List lock expiry",
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pending?.catch(() => {});
  }
});

test("HTTP bodyless mutations accept ended empty streams and reject bytes or invalid lengths", async (t) => {
  const f = await fixture(t);
  const track = await addTrack(f);
  const { handleListRequest } = await import("../../tracks/lists-http");
  const origin = "http://localhost";
  const deps = { ...f, origin };
  const list = await createTrackList({
    ...f,
    input: { name: "Empty streams" },
  });
  const paths = [
    ["PUT", `/api/lists/${list.id}/tracks/${track.id}`],
    ["DELETE", `/api/lists/${list.id}/tracks/${track.id}`],
    ["DELETE", `/api/lists/${list.id}`],
  ];
  for (const [method, path] of paths) {
    for (const length of path.endsWith(track.id) ? [undefined, "0"] : ["0"]) {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(0));
          c.close();
        },
      });
      const request = new Request(`${origin}${path}`, {
        method,
        headers: { origin, ...(length ? { "content-length": length } : {}) },
        body,
        duplex: "half",
      } as RequestInit);
      assert.equal((await handleListRequest(request, deps)).status, 204);
    }
    for (const length of ["-1", "NaN", "1.5", "9007199254740992", "1"]) {
      assert.equal(
        (
          await handleListRequest(
            new Request(`${origin}${path}`, {
              method,
              headers: { origin, "content-length": length },
            }),
            deps,
          )
        ).status,
        400,
      );
    }
    const controller = new AbortController();
    let cancelled = false;
    const pending = handleListRequest(
      new Request(`${origin}${path}`, {
        method,
        headers: { origin },
        signal: controller.signal,
        body: new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
        duplex: "half",
      } as RequestInit),
      deps,
    );
    controller.abort();
    assert.equal((await pending).status, 400);
    assert.equal(cancelled, true);
    for (const length of [
      undefined,
      "0",
      "1",
      "-1",
      "NaN",
      "1.5",
      "9007199254740992",
    ]) {
      const request = new Request(`${origin}${path}`, {
        method,
        headers: { origin, ...(length ? { "content-length": length } : {}) },
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array(33000));
            c.close();
          },
        }),
        duplex: "half",
      } as RequestInit);
      assert.equal((await handleListRequest(request, deps)).status, 400);
    }
  }
});

test("HTTP empty-body ingestion bounds zero-length chunks and rejects pre-aborted streams", async (t) => {
  const f = await fixture(t);
  const list = await createTrackList({
    ...f,
    input: { name: "Bounded empty body" },
  });
  const { handleListRequest } = await import("../../tracks/lists-http");
  const origin = "http://localhost";
  let cancelled = false;
  let reads = 0;
  const response = await handleListRequest(
    new Request(`${origin}/api/lists/${list.id}`, {
      method: "DELETE",
      headers: { origin, "content-length": "0" },
      body: new ReadableStream<Uint8Array>({
        pull(c) {
          if (++reads <= 2048) c.enqueue(new Uint8Array(0));
          else c.close();
        },
        cancel() {
          cancelled = true;
        },
      }),
      duplex: "half",
    } as RequestInit),
    { ...f, origin },
  );
  assert.equal(response.status, 400);
  assert.equal(cancelled, true);
  assert.ok(reads < 2048);
  assert.equal(
    (await getTrackList({ ...f, id: list.id }))?.name,
    "Bounded empty body",
  );

  const controller = new AbortController();
  controller.abort();
  const aborted = await handleListRequest(
    new Request(`${origin}/api/lists/${list.id}`, {
      method: "DELETE",
      headers: { origin },
      signal: controller.signal,
      body: new ReadableStream<Uint8Array>({}),
      duplex: "half",
    } as RequestInit),
    { ...f, origin },
  );
  assert.equal(aborted.status, 400);
});

test("HTTP byte rejection does not wait for a producer's cancellation hook", async (t) => {
  const f = await fixture(t);
  const list = await createTrackList({
    ...f,
    input: { name: "Slow cancellation" },
  });
  const { handleListRequest } = await import("../../tracks/lists-http");
  const origin = "http://localhost";
  let release!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = handleListRequest(
    new Request(`${origin}/api/lists/${list.id}`, {
      method: "DELETE",
      headers: { origin, "content-length": "0" },
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([1]));
        },
        cancel() {
          return cancelled;
        },
      }),
      duplex: "half",
    } as RequestInit),
    { ...f, origin },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 500);
      }),
    ]);
    assert.equal(response?.status, 400);
  } finally {
    clearTimeout(timer);
    release();
    await pending;
  }
  assert.equal(
    (await getTrackList({ ...f, id: list.id }))?.name,
    "Slow cancellation",
  );
});

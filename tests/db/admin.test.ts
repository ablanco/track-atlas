import { handleAdminMutation } from "../../admin/mutation-http";
import { createAcceptedSession as createSession } from "../helpers/accepted-session";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../../db/client";
import { authTransaction, fixtureUser } from "./auth-helpers";
import {
  listAdminRecords,
  getAdminRecord,
  getAdminOverview,
} from "../../admin/queries";
import { adminModels } from "../../admin/models";
import { handleAdminRead } from "../../admin/http";
loadEnvConfig(process.cwd(), true);
const { pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());
test("admin reads reject ordinary accounts and revoked privileges on next request", async (t) => {
  const { client, db } = await authTransaction(t, pool);
  const user = await fixtureUser(client);
  const { token } = await createSession(db, user);
  await assert.rejects(
    listAdminRecords(db, token, "users", new URLSearchParams()),
    { code: "forbidden" },
  );
  await client.query("UPDATE users SET admin=true WHERE id=$1", [user]);
  const page = await listAdminRecords(
    db,
    token,
    "users",
    new URLSearchParams({ q: user }),
  );
  assert.equal(page.total, 1);
  assert.equal(page.rows[0].values.email_confirmed, false);
  assert.ok(!JSON.stringify(page).includes("password_hash"));
  await client.query("UPDATE users SET admin=false WHERE id=$1", [user]);
  await assert.rejects(getAdminOverview(db, token), { code: "forbidden" });
  await client.query("UPDATE users SET admin=true,active=false WHERE id=$1", [
    user,
  ]);
  await assert.rejects(getAdminOverview(db, token), { code: "unauthorized" });
});
test("all model reads, composite IDs, relations, filters and bounded pages", async (t) => {
  const { client, db } = await authTransaction(t, pool);
  const user = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [user]);
  const { token } = await createSession(db, user);
  const list = (
    await client.query(
      "INSERT INTO track_lists(owner_id,name,normalized_name) VALUES($1,'Test admin list','test admin list') RETURNING id",
      [user],
    )
  ).rows[0].id;
  for (const model of Object.keys(adminModels)) {
    const page = await listAdminRecords(
      db,
      token,
      model,
      new URLSearchParams({ pageSize: "25" }),
    );
    assert.ok(page.rows.length <= 25);
    assert.ok(
      !/password_hash|token_hash|object_key|storage_location/.test(
        JSON.stringify(page),
      ),
    );
    for (const row of page.rows.slice(0, 1)) {
      const detail = await getAdminRecord(db, token, model, row.id);
      assert.equal(detail.record.id, row.id);
    }
  }
  const page = await listAdminRecords(
    db,
    token,
    "track_lists",
    new URLSearchParams({
      owner_id: user,
      page: "999",
      pageSize: "50",
      direction: "asc",
      sort: "name",
    }),
  );
  assert.equal(page.total, 1);
  assert.equal(page.page, 1);
  assert.equal(page.rows[0].values.membership_count, 0);
  assert.deepEqual(page.rows[0].related, [
    {
      field: "owner_id",
      model: "users",
      id: JSON.stringify([user]),
      label: "Ada Lovelace",
    },
  ]);
  assert.equal(JSON.parse(page.rows[0].id)[0], list);
  for (const model of [
    "captcha_uses",
    "track_upload_attempts",
    "deleted_track_uploads",
    "email_send_limits",
  ]) {
    assert.equal(Object.hasOwn(adminModels, model), false);
    for (const id of [undefined, JSON.stringify([user])]) {
      const response = await handleAdminRead(
        new Request(`http://localhost/api/admin/${model}`),
        db,
        token,
        model,
        id,
      );
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalidRequest" });
    }
  }
  for (const query of [
    { sort: "password_hash" },
    { pageSize: "500" },
    { unknown: "x" },
    { direction: "drop table users" },
  ])
    await assert.rejects(
      listAdminRecords(
        db,
        token,
        "users",
        new URLSearchParams(query as unknown as Record<string, string>),
      ),
      { code: "invalidRequest" },
    );
  await assert.rejects(
    listAdminRecords(
      db,
      token,
      "users;drop table users",
      new URLSearchParams(),
    ),
    { code: "invalidRequest" },
  );
  const overview = await getAdminOverview(db, token);
  assert.deepEqual(
    overview.cards.map(({ model, filters }) => ({ model, filters })),
    [
      { model: "users", filters: {} },
      { model: "users", filters: { active: "true" } },
      { model: "tracks", filters: {} },
      { model: "tracks", filters: { visibility: "public" } },
    ],
  );
  assert.ok(Number(overview.storage.bytes) >= 0);
  await client.query("DELETE FROM sessions WHERE user_id=$1", [user]);
  await assert.rejects(
    listAdminRecords(db, token, "users", new URLSearchParams()),
    { code: "unauthorized" },
  );
});
test("large track data details return bounded points and samples without full arrays", async (t) => {
  const { client, db } = await authTransaction(t, pool);
  const user = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [user]);
  const { token } = await createSession(db, user);
  const file = (
    await client.query(
      "WITH id AS (SELECT gen_random_uuid() AS id) INSERT INTO stored_files(id,owner_id,purpose,storage_location,object_key,byte_size) SELECT id,$1,'gpx',repeat('a',64),id::text,100 FROM id RETURNING id",
      [user],
    )
  ).rows[0].id;
  const track = (
    await client.query(
      "INSERT INTO tracks(owner_id,original_file_id,request_id,name,description,activity,difficulty,point_count,distance_meters,elevation_sample_count,version) VALUES($1,$2,gen_random_uuid(),'Admin track','Test track','hiking',1,30,100,0,1) RETURNING id",
      [user, file],
    )
  ).rows[0].id;
  await client.query(
    "INSERT INTO track_data(track_id,geometry,samples) SELECT $1,ST_Multi(ST_MakeLine(array_agg(ST_SetSRID(ST_MakePoint(i/100.0,40),4326) ORDER BY i))),jsonb_agg(jsonb_build_object('distanceMeters',i,'elevationMeters',null,'speedMps',null) ORDER BY i) FROM generate_series(0,29) i",
    [track],
  );
  const detail = await getAdminRecord(
    db,
    token,
    "track_data",
    JSON.stringify([track]),
  );
  assert.equal(detail.record.values.point_count, 30);
  assert.equal((detail.data as unknown[]).length, 25);
  assert.ok(!("geometry" in detail.record.values));
  assert.ok(!("samples" in detail.record.values));
  const next = await getAdminRecord(
    db,
    token,
    "track_data",
    detail.record.id,
    new URLSearchParams({ page: "2" }),
  );
  assert.equal((next.data as unknown[]).length, 5);
  await client.query(
    "UPDATE track_data SET geometry=ST_GeomFromText('MULTILINESTRING((0 0,1 0),(20 10,21 10))',4326), segment_starts='[0,2]', samples='[{},{},{},{}]' WHERE track_id=$1",
    [track],
  );
  await client.query(
    "INSERT INTO track_directional_representations(track_id,segment_index,intermediate_count,geometry,directionless_edges,version) SELECT $1,n,0,ST_GeomFromText('LINESTRING(0 0,1 0)',4326),'[false]',2 FROM generate_series(0,1) n",
    [track],
  );
  const representations = await listAdminRecords(
    db,
    token,
    "track_directional_representations",
    new URLSearchParams({ track_id: track }),
  );
  assert.equal(representations.total, 2);
  for (const segment of [0, 1]) {
    const id = JSON.stringify([track, segment, 0]);
    const representation = await getAdminRecord(
      db,
      token,
      "track_directional_representations",
      id,
    );
    assert.equal(representation.record.values.segment_index, segment);
    assert.equal(representation.record.selectable, false);
  }
  await assert.rejects(
    getAdminRecord(
      db,
      token,
      "track_directional_representations",
      JSON.stringify([track, 0]),
    ),
    { code: "invalidRequest" },
  );
  for (const [model, values] of [
    ["tracks", { segment_count: 1 }],
    ["track_data", { segment_starts: [0] }],
    ["track_directional_representations", { segment_index: 0 }],
  ]) {
    const response = await handleAdminMutation(
      new Request("https://atlas.example/api/admin/mutations", {
        method: "POST",
        headers: {
          origin: "https://atlas.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          operation: "update",
          ids: [JSON.stringify([track])],
          values,
        }),
      }),
      { db, token, origin: "https://atlas.example" },
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalidRequest" });
  }
  const multipart = await getAdminRecord(
    db,
    token,
    "track_data",
    detail.record.id,
  );
  assert.deepEqual(
    (
      multipart.data as {
        index: number;
        segment_index: number;
        point: unknown;
      }[]
    ).map(({ index, segment_index, point }) => ({
      index,
      segment_index,
      point,
    })),
    [
      {
        index: 0,
        segment_index: 0,
        point: { type: "Point", coordinates: [0, 0] },
      },
      {
        index: 1,
        segment_index: 0,
        point: { type: "Point", coordinates: [1, 0] },
      },
      {
        index: 2,
        segment_index: 1,
        point: { type: "Point", coordinates: [20, 10] },
      },
      {
        index: 3,
        segment_index: 1,
        point: { type: "Point", coordinates: [21, 10] },
      },
    ],
  );
});

test("overview history accumulates 365 UTC days with earlier records and current status filters", async (t) => {
  const { client, db } = await authTransaction(t, pool);
  const actor = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  const { token } = await createSession(db, actor);
  // Put known active/inactive records on both sides of the inclusive window.
  for (const [daysAgo, active] of [
    [364, true],
    [364, false],
    [365, true],
    [-1, true],
  ] as const) {
    const user = await fixtureUser(client);
    await client.query(
      "UPDATE users SET active=$2, created_at=((statement_timestamp() AT TIME ZONE 'UTC')::date - $3::int)::timestamp AT TIME ZONE 'UTC' WHERE id=$1",
      [user, active, daysAgo],
    );
  }
  for (const [daysAgo, visibility] of [
    [364, "public"],
    [364, "private"],
    [365, "public"],
    [-1, "public"],
    [0, "public"],
  ] as const) {
    const file = (
      await client.query(
        "WITH id AS (SELECT gen_random_uuid() AS id) INSERT INTO stored_files(id,owner_id,purpose,storage_location,object_key,byte_size) SELECT id,$1,'gpx',repeat('a',64),id::text,100 FROM id RETURNING id",
        [actor],
      )
    ).rows[0].id;
    await client.query(
      "INSERT INTO tracks(owner_id,original_file_id,request_id,name,description,activity,difficulty,visibility,point_count,distance_meters,elevation_sample_count,version,created_at) VALUES($1,$2,gen_random_uuid(),'History track','History test','hiking',1,$3,2,100,0,1,((statement_timestamp() AT TIME ZONE 'UTC')::date - $4::int)::timestamp AT TIME ZONE 'UTC')",
      [actor, file, visibility, daysAgo],
    );
  }
  const { history } = await getAdminOverview(db, token);
  const today = (
    await client.query(
      "SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') AS date",
    )
  ).rows[0].date;
  assert.equal(history.length, 365);
  assert.equal(history[364].date, today);
  assert.equal(history[0].activeUsers, 2);
  assert.equal(history[0].publicTracks, 2);
  assert.equal(history[364].activeUsers, 3);
  assert.equal(history[364].publicTracks, 3);
  assert.equal(
    history.reduce((n, d) => n + d.activeUsers, 0),
    731,
  );
  assert.equal(
    history.reduce((n, d) => n + d.publicTracks, 0),
    731,
  );
  for (let i = 1; i < history.length; i++) {
    assert.equal(
      Date.parse(history[i].date) - Date.parse(history[i - 1].date),
      86400000,
    );
    if (i < 364)
      assert.deepEqual(history[i], {
        date: history[i].date,
        activeUsers: 2,
        publicTracks: 2,
      });
  }
});

test("a full admin page resolves a shared owner's safe label with bounded database work", async (t) => {
  const { client } = await authTransaction(t, pool);
  const queries: { query: string; params: unknown[] }[] = [];
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../../db/schema");
  const db = drizzle({
    client,
    schema,
    logger: {
      logQuery(query, params) {
        queries.push({ query, params });
      },
    },
  });
  const actor = await fixtureUser(client);
  const owner = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  await client.query(
    "UPDATE users SET display_name='Shared owner',active=false,password_hash='private-credential' WHERE id=$1",
    [owner],
  );
  await client.query(
    "INSERT INTO track_lists(owner_id,name,normalized_name) SELECT $1,'List '||i,'list '||i FROM generate_series(1,101) i",
    [owner],
  );
  const { token } = await createSession(db, actor);
  queries.length = 0;
  const page = await listAdminRecords(
    db,
    token,
    "track_lists",
    new URLSearchParams({
      owner_id: owner,
      pageSize: "100",
      sort: "name",
      direction: "asc",
    }),
  );
  assert.equal(page.total, 101);
  assert.equal(page.rows.length, 100);
  for (const row of page.rows)
    assert.deepEqual(row.related, [
      {
        field: "owner_id",
        model: "users",
        id: JSON.stringify([owner]),
        label: "Shared owner",
      },
    ]);
  assert.ok(
    queries.length <= 4,
    `Full page exceeded four database reads: ${queries.length}`,
  );
  // Observe the real adapter boundary: the shared target occurs once in label lookup parameters.
  const labelReads = queries.filter(
    ({ query }) =>
      query.includes('"display_name"') && !query.includes('"sessions"'),
  );
  assert.equal(labelReads.length, 1);
  assert.equal(labelReads[0].params.filter((p) => p === owner).length, 1);
  assert.ok(
    !/private-credential|password_hash|token_hash|object_key|storage_location/.test(
      JSON.stringify(page),
    ),
  );
  const detail = await getAdminRecord(
    db,
    token,
    "track_lists",
    page.rows[0].id,
  );
  assert.deepEqual(detail.record.related, page.rows[0].related);
  const last = await listAdminRecords(
    db,
    token,
    "track_lists",
    new URLSearchParams({
      owner_id: owner,
      pageSize: "100",
      page: "2",
      sort: "name",
      direction: "asc",
    }),
  );
  assert.equal(last.rows.length, 1);
  assert.notEqual(last.rows[0].id, page.rows[0].id);
  await client.query("UPDATE users SET admin=false WHERE id=$1", [actor]);
  await assert.rejects(
    listAdminRecords(db, token, "track_lists", new URLSearchParams()),
    { code: "forbidden" },
  );
  await assert.rejects(
    getAdminRecord(db, token, "track_lists", page.rows[0].id),
    { code: "forbidden" },
  );
  await client.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  await client.query("DELETE FROM sessions WHERE user_id=$1", [actor]);
  await assert.rejects(
    getAdminRecord(db, token, "track_lists", page.rows[0].id),
    { code: "unauthorized" },
  );
});

test("admin details retain named track/list labels and identifier-only relationships", async (t) => {
  const { client, db } = await authTransaction(t, pool);
  const actor = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  const { token } = await createSession(db, actor);
  const list = (
    await client.query(
      "INSERT INTO track_lists(owner_id,name,normalized_name) VALUES($1,'Private itinerary','private itinerary') RETURNING id",
      [actor],
    )
  ).rows[0].id;
  const file = (
    await client.query(
      "WITH id AS (SELECT gen_random_uuid() AS id) INSERT INTO stored_files(id,owner_id,purpose,storage_location,object_key,byte_size) SELECT id,$1,'gpx',repeat('a',64),id::text,100 FROM id RETURNING id",
      [actor],
    )
  ).rows[0].id;
  const track = (
    await client.query(
      "INSERT INTO tracks(owner_id,original_file_id,request_id,name,description,activity,difficulty,point_count,distance_meters,elevation_sample_count,version) VALUES($1,$2,gen_random_uuid(),'Private summit','Private description','hiking',1,2,100,0,1) RETURNING id",
      [actor, file],
    )
  ).rows[0].id;
  await client.query(
    "INSERT INTO track_list_memberships(list_id,track_id) VALUES($1,$2)",
    [list, track],
  );
  const membership = await getAdminRecord(
    db,
    token,
    "track_list_memberships",
    JSON.stringify([list, track]),
  );
  assert.deepEqual(membership.record.related, [
    {
      field: "track_id",
      model: "tracks",
      id: JSON.stringify([track]),
      label: "Private summit",
    },
    {
      field: "list_id",
      model: "track_lists",
      id: JSON.stringify([list]),
      label: "Private itinerary",
    },
  ]);
  assert.ok(!JSON.stringify(membership).includes("Private description"));
  const detail = await getAdminRecord(
    db,
    token,
    "tracks",
    JSON.stringify([track]),
  );
  assert.deepEqual(detail.record.related, [
    {
      field: "owner_id",
      model: "users",
      id: JSON.stringify([actor]),
      label: "Ada Lovelace",
    },
    {
      field: "original_file_id",
      model: "stored_files",
      id: JSON.stringify([file]),
    },
  ]);
  const page = await listAdminRecords(
    db,
    token,
    "track_list_memberships",
    new URLSearchParams({ list_id: list }),
  );
  assert.deepEqual(page.rows[0].related, membership.record.related);
});

test("a related target disappearing during an admin read keeps the identifier fallback", async (t) => {
  const { client } = await authTransaction(t, pool);
  const actor = await fixtureUser(client);
  const owner = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  const list = (
    await client.query(
      "INSERT INTO track_lists(owner_id,name,normalized_name) VALUES($1,'Disappearing owner','disappearing owner') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../../db/schema");
  let deletion: Promise<unknown> | undefined;
  const db = drizzle({
    client,
    schema,
    logger: {
      logQuery(query) {
        if (query.includes('FROM "users" WHERE id IN')) {
          // Queue a real database deletion between the source read and target read.
          // FK cascades are retained; the already-read list snapshot still has its owner ID.
          deletion = client.query("DELETE FROM users WHERE id=$1", [owner]);
        }
      },
    },
  });
  const { token } = await createSession(db, actor);
  const detail = await getAdminRecord(
    db,
    token,
    "track_lists",
    JSON.stringify([list]),
  );
  await deletion;
  assert.ok(
    deletion,
    "target deletion must occur at the real adapter boundary",
  );
  assert.equal(detail.record.values.owner_id, owner);
  assert.deepEqual(detail.record.related, [
    { field: "owner_id", model: "users", id: JSON.stringify([owner]) },
  ]);
});

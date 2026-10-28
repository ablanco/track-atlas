import assert from "node:assert/strict";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../../db/client";
import { createSession } from "../../auth/session-store";
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
    { field: "owner_id", model: "users", id: JSON.stringify([user]) },
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
    "INSERT INTO track_data(track_id,geometry,samples) SELECT $1,ST_MakeLine(array_agg(ST_SetSRID(ST_MakePoint(i/100.0,40),4326) ORDER BY i)),jsonb_agg(jsonb_build_object('distanceMeters',i,'elevationMeters',null,'speedMps',null) ORDER BY i) FROM generate_series(0,29) i",
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

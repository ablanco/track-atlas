import { randomUUID } from "node:crypto";
import { createTrack } from "../../tracks/service";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../../db/client";
import { createSession } from "../../auth/session-store";
import { fixtureUser as insertFixtureUser } from "./auth-helpers";
import type { PoolClient } from "pg";
const fixtureIds: string[] = [];
async function fixtureUser(client: PoolClient) {
  const id = await insertFixtureUser(client);
  fixtureIds.push(id);
  return id;
}
import { mutateAdminRecords } from "../../admin/mutations";
loadEnvConfig(process.cwd(), true);
const { pool, db } = createDatabase(process.env.DATABASE_URL);
after(async () => {
  try {
    await pool.query("DELETE FROM tracks WHERE owner_id=ANY($1::uuid[])", [
      fixtureIds,
    ]);
    await pool.query(
      "DELETE FROM stored_files WHERE owner_id=ANY($1::uuid[])",
      [fixtureIds],
    );
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      fixtureIds,
    ]);
  } finally {
    await pool.end();
  }
});
test("admin cannot remove own privileges and invalid batches roll back", async (t) => {
  const client = await pool.connect();
  t.after(() => client.release());
  const actor = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  const { token } = await createSession(db, actor);
  await assert.rejects(
    mutateAdminRecords(db, token, {
      model: "users",
      operation: "update",
      ids: [JSON.stringify([actor])],
      values: { admin: false },
    }),
    { code: "forbidden" },
  );
  const target = await fixtureUser(client);
  const session = await createSession(db, target);
  const row = (
    await client.query("SELECT id FROM sessions WHERE user_id=$1", [target])
  ).rows[0];
  await assert.rejects(
    mutateAdminRecords(db, token, {
      model: "sessions",
      operation: "revoke",
      ids: [
        JSON.stringify([row.id]),
        JSON.stringify(["00000000-0000-4000-8000-000000000001"]),
      ],
    }),
    { code: "notFound" },
  );
  assert.equal(
    (
      await client.query("SELECT count(*)::int n FROM sessions WHERE id=$1", [
        row.id,
      ])
    ).rows[0].n,
    1,
  );
  assert.ok(session.token);
});

test("email delivery failure preserves saved address, revocations, and unconfirmed state", async (t) => {
  const client = await pool.connect();
  t.after(() => client.release());
  const actor = await fixtureUser(client),
    target = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  const { token } = await createSession(db, actor);
  await createSession(db, target);
  await client.query(
    "INSERT INTO account_action_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'password-reset',md5(random()::text)||md5(random()::text),now()+interval '1 hour')",
    [target],
  );
  const result = await mutateAdminRecords(
    db,
    token,
    {
      model: "users",
      operation: "update",
      ids: [JSON.stringify([target])],
      values: { email: `changed-${target}@example.test` },
    },
    { send: async () => ({ ok: false, reason: "unavailable" }) },
  );
  assert.deepEqual(result, { ok: true, warning: "confirmationDeliveryFailed" });
  const user = (
    await client.query("SELECT email,email_confirmed FROM users WHERE id=$1", [
      target,
    ])
  ).rows[0];
  assert.equal(user.email, `changed-${target}@example.test`);
  assert.equal(user.email_confirmed, false);
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM sessions WHERE user_id=$1",
        [target],
      )
    ).rows[0].n,
    0,
  );
  assert.ok(
    (
      await client.query(
        "SELECT revoked_at FROM account_action_tokens WHERE user_id=$1 AND purpose='password-reset'",
        [target],
      )
    ).rows[0].revoked_at,
  );
});

test("deactivation revokes sessions and privilege changes apply on next mutation", async (t) => {
  const client = await pool.connect();
  t.after(() => client.release());
  const actor = await fixtureUser(client),
    target = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=ANY($1::uuid[])", [
    [actor, target],
  ]);
  const a = await createSession(db, actor),
    b = await createSession(db, target);
  await mutateAdminRecords(db, a.token, {
    model: "users",
    operation: "update",
    ids: [JSON.stringify([target])],
    values: { admin: false },
  });
  await assert.rejects(
    mutateAdminRecords(db, b.token, {
      model: "users",
      operation: "update",
      ids: [JSON.stringify([actor])],
      values: { display_name: "No" },
    }),
    { code: "forbidden" },
  );
  await mutateAdminRecords(db, a.token, {
    model: "users",
    operation: "update",
    ids: [JSON.stringify([target])],
    values: { active: false },
  });
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM sessions WHERE user_id=$1",
        [target],
      )
    ).rows[0].n,
    0,
  );
  await mutateAdminRecords(db, a.token, {
    model: "users",
    operation: "update",
    ids: [JSON.stringify([target])],
    values: { active: true },
  });
  await assert.rejects(
    mutateAdminRecords(db, b.token, {
      model: "users",
      operation: "update",
      ids: [JSON.stringify([actor])],
      values: { display_name: "No" },
    }),
    { code: "unauthorized" },
  );
});

test("track deletion preserves receipts, cascades memberships and schedules original cleanup", async (t) => {
  const client = await pool.connect();
  t.after(() => client.release());
  const actor = await fixtureUser(client),
    owner = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  const { token } = await createSession(db, actor);
  await client.query("UPDATE users SET email_confirmed=true WHERE id=$1", [
    owner,
  ]);
  const ownerSession = await createSession(db, owner);
  const requestId = randomUUID();
  const created = await createTrack({
    db,
    token: ownerSession.token,
    store: {
      location: "a".repeat(64),
      put: async () => {},
      get: async () => null,
      remove: async () => {},
    },
    read: async () => ({
      requestId,
      input: {
        name: "Before",
        description: "Description",
        activity: "hiking",
        difficulty: 1,
        tags: [],
      },
      bytes: Buffer.from(
        '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests"><trk><trkseg><trkpt lat="40" lon="1"/><trkpt lat="40.01" lon="1.01"/></trkseg></trk></gpx>',
      ),
    }),
  });
  const track = { id: created.id, request_id: requestId };
  const file = (
    await client.query("SELECT original_file_id FROM tracks WHERE id=$1", [
      track.id,
    ])
  ).rows[0].original_file_id;
  await mutateAdminRecords(db, token, {
    model: "tracks",
    operation: "update",
    ids: [JSON.stringify([track.id])],
    values: { name: "After", tags: ["Hill", "hill", "Forest"] },
  });
  assert.deepEqual(
    (
      await client.query(
        "SELECT label FROM track_tags WHERE track_id=$1 ORDER BY ordinal",
        [track.id],
      )
    ).rows.map((r) => r.label),
    ["Hill", "Forest"],
  );
  const list = (
    await client.query(
      "INSERT INTO track_lists(owner_id,name,normalized_name) VALUES($1,'Saved','saved') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  await client.query(
    "INSERT INTO track_list_memberships(list_id,track_id) VALUES($1,$2)",
    [list, track.id],
  );
  await mutateAdminRecords(db, token, {
    model: "tracks",
    operation: "delete",
    ids: [JSON.stringify([track.id])],
  });
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM track_list_memberships WHERE list_id=$1",
        [list],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await client.query(
        "SELECT track_id FROM deleted_track_uploads WHERE owner_id=$1 AND request_id=$2",
        [owner, track.request_id],
      )
    ).rows[0].track_id,
    track.id,
  );
  assert.equal(
    (await client.query("SELECT status FROM stored_files WHERE id=$1", [file]))
      .rows[0].status,
    "deleting",
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM track_tags WHERE track_id=$1",
        [track.id],
      )
    ).rows[0].n,
    0,
  );
});

test("a forbidden later batch item rolls back earlier revocation", async (t) => {
  const client = await pool.connect();
  t.after(() => client.release());
  const actor = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  const a = await createSession(db, actor),
    b = await createSession(db, actor);
  const rows = (
    await client.query("SELECT id,token_hash FROM sessions WHERE user_id=$1", [
      actor,
    ])
  ).rows;
  const { hashAccountToken } = await import("../../auth/account-token");
  const own = rows.find((r) => r.token_hash === hashAccountToken(a.token))!,
    other = rows.find((r) => r.token_hash === hashAccountToken(b.token))!;
  await assert.rejects(
    mutateAdminRecords(db, a.token, {
      model: "sessions",
      operation: "revoke",
      ids: [JSON.stringify([other.id]), JSON.stringify([own.id])],
    }),
    { code: "forbidden" },
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM sessions WHERE user_id=$1",
        [actor],
      )
    ).rows[0].n,
    2,
  );
});

test("HTTP rejects cross-site, malformed, immutable and readonly requests safely", async (t) => {
  const { handleAdminMutation } = await import("../../admin/mutation-http");
  const client = await pool.connect();
  t.after(() => client.release());
  const actor = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  const { token } = await createSession(db, actor);
  const origin = "http://localhost:3000";
  for (const [body, site, status] of [
    [
      {
        model: "users",
        operation: "update",
        ids: [JSON.stringify([actor])],
        values: { password_hash: "oops" },
      },
      "same-origin",
      400,
    ],
    [
      {
        model: "captcha_uses",
        operation: "delete",
        ids: [JSON.stringify([actor])],
      },
      "same-origin",
      400,
    ],
    [{}, "cross-site", 403],
    ["{", "same-origin", 400],
  ] as const) {
    const response = await handleAdminMutation(
      new Request(origin + "/api/admin/mutations", {
        method: "POST",
        headers: {
          origin,
          "sec-fetch-site": site,
          "content-type": "application/json",
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      { db, token, origin },
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.ok(!JSON.stringify(await response.json()).includes("password"));
  }
});

test("session expiry while waiting for a target account lock rolls back the edit", async (t) => {
  const client = await pool.connect();
  t.after(() => client.release());
  const actor = await fixtureUser(client),
    target = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  const { token } = await createSession(db, actor);
  await client.query(
    "UPDATE sessions SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE user_id=$1",
    [actor],
  );
  await client.query("BEGIN");
  await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [target]);
  const pending = assert.rejects(
    mutateAdminRecords(db, token, {
      model: "users",
      operation: "update",
      ids: [JSON.stringify([target])],
      values: { display_name: "Expired" },
    }),
    { code: "unauthorized" },
  );
  await new Promise((resolve) => setTimeout(resolve, 450));
  await client.query("ROLLBACK");
  await pending;
  assert.equal(
    (await client.query("SELECT display_name FROM users WHERE id=$1", [target]))
      .rows[0].display_name,
    null,
  );
});

test("foreign inactive owners retain list management and eligible avatar cleanup", async (t) => {
  const client = await pool.connect();
  t.after(() => client.release());
  const actor = await fixtureUser(client),
    target = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  await client.query("UPDATE users SET active=false WHERE id=$1", [target]);
  const { token } = await createSession(db, actor);
  const list = (
    await client.query(
      "INSERT INTO track_lists(owner_id,name,normalized_name) VALUES($1,'Old','old') RETURNING id",
      [target],
    )
  ).rows[0].id;
  await mutateAdminRecords(db, token, {
    model: "track_lists",
    operation: "update",
    ids: [JSON.stringify([list])],
    values: { name: " New " },
  });
  assert.equal(
    (await client.query("SELECT name FROM track_lists WHERE id=$1", [list]))
      .rows[0].name,
    "New",
  );
  await mutateAdminRecords(db, token, {
    model: "track_lists",
    operation: "delete",
    ids: [JSON.stringify([list])],
  });
  assert.equal(
    (await client.query("SELECT id FROM track_lists WHERE id=$1", [list])).rows
      .length,
    0,
  );
  const file = (
    await client.query(
      "WITH id AS(SELECT gen_random_uuid() id) INSERT INTO stored_files(id,owner_id,purpose,status,storage_location,object_key,byte_size,content_type,sha256) SELECT id,$1,'avatar','ready',repeat('a',64),'avatars/original/'||id::text,100,'image/png',repeat('a',64) FROM id RETURNING id",
      [target],
    )
  ).rows[0].id;
  await client.query("UPDATE users SET avatar_file_id=$1 WHERE id=$2", [
    file,
    target,
  ]);
  await mutateAdminRecords(db, token, {
    model: "stored_files",
    operation: "delete",
    ids: [JSON.stringify([file])],
  });
  assert.equal(
    (
      await client.query("SELECT avatar_file_id FROM users WHERE id=$1", [
        target,
      ])
    ).rows[0].avatar_file_id,
    null,
  );
  assert.equal(
    (await client.query("SELECT status FROM stored_files WHERE id=$1", [file]))
      .rows[0].status,
    "deleting",
  );
});

test("administrator revocation during account lock wait prevents mutation", async (t) => {
  const client = await pool.connect();
  t.after(() => client.release());
  const actor = await fixtureUser(client),
    target = await fixtureUser(client);
  await client.query("UPDATE users SET admin=true WHERE id=$1", [actor]);
  const { token } = await createSession(db, actor);
  await client.query("BEGIN");
  await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [actor]);
  const pending = assert.rejects(
    mutateAdminRecords(db, token, {
      model: "users",
      operation: "update",
      ids: [JSON.stringify([target])],
      values: { display_name: "Rejected" },
    }),
    { code: "forbidden" },
  );
  // The authorization read sees the committed admin, then waits for this row lock.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await client.query("UPDATE users SET admin=false WHERE id=$1", [actor]);
  await client.query("COMMIT");
  await pending;
  assert.equal(
    (await client.query("SELECT display_name FROM users WHERE id=$1", [target]))
      .rows[0].display_name,
    null,
  );
});

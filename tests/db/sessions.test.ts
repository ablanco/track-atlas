import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../../db/client";
import { createSession, findSessionUser } from "../../auth/session-store";
import { authTransaction, fixtureUser } from "./auth-helpers";

loadEnvConfig(process.cwd(), true);
const { pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());

test("sessions default identifiers/audit times and store only token digests with DB expiry", async (t) => {
  const { client, db } = await authTransaction(t, pool);
  const id = await fixtureUser(client);
  const first = await createSession(db, id);
  const second = await createSession(db, id);
  assert.notEqual(first.token, second.token);
  const { rows } = await client.query(
    "SELECT *, extract(epoch from (expires_at-statement_timestamp())) AS seconds FROM sessions WHERE user_id=$1 ORDER BY created_at",
    [id],
  );
  assert.equal(rows.length, 2);
  const row = rows.find(
    (row) =>
      row.token_hash === createHash("sha256").update(first.token).digest("hex"),
  );
  assert.ok(row);
  assert.match(row.id, /^[\da-f-]{36}$/);
  assert.ok(row.created_at instanceof Date);
  assert.equal(row.created_at.getTime(), row.updated_at.getTime());
  assert.equal(row.expires_at.getTime(), first.expiresAt.getTime());
  assert.ok(Number(row.seconds) > 2591990 && Number(row.seconds) <= 2592000);
  assert.ok(!JSON.stringify(rows).includes(first.token));
  assert.deepEqual(await findSessionUser(db, first.token), {
    userId: id,
    firstName: "Ada",
    lastName: "Lovelace",
    displayName: null,
    avatarFileId: null,
    admin: false,
  });
  await client.query("UPDATE users SET display_name='Countess' WHERE id=$1", [
    id,
  ]);
  assert.deepEqual(await findSessionUser(db, first.token), {
    userId: id,
    firstName: "Ada",
    lastName: "Lovelace",
    displayName: "Countess",
    avatarFileId: null,
    admin: false,
  });
});

test("expired, unknown, tampered, inactive and deleted-user sessions do not authenticate", async (t) => {
  const { client, db } = await authTransaction(t, pool);
  const id = await fixtureUser(client);
  const { token } = await createSession(db, id);
  assert.equal(
    await findSessionUser(db, randomBytes(32).toString("base64url")),
    null,
  );
  assert.equal(
    await findSessionUser(
      db,
      `${token.slice(0, 20)}${token[20] === "a" ? "b" : "a"}${token.slice(21)}`,
    ),
    null,
  );
  await client.query(
    "UPDATE sessions SET expires_at=statement_timestamp()-interval '1 second' WHERE user_id=$1",
    [id],
  );
  assert.equal(await findSessionUser(db, token), null);
  const fresh = await createSession(db, id);
  await client.query("UPDATE users SET active=false WHERE id=$1", [id]);
  assert.equal(await findSessionUser(db, fresh.token), null);
  await client.query("DELETE FROM users WHERE id=$1", [id]);
  assert.equal(await findSessionUser(db, fresh.token), null);
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS count FROM sessions WHERE user_id=$1",
        [id],
      )
    ).rows[0].count,
    0,
  );
});

test("session audit trigger advances updated time through direct SQL", async (t) => {
  const { client, db } = await authTransaction(t, pool);
  const id = await fixtureUser(client);
  await createSession(db, id);
  const original = (
    await client.query(
      "SELECT created_at::text AS created, updated_at::text AS updated FROM sessions WHERE user_id=$1",
      [id],
    )
  ).rows[0];
  const result = await client.query(
    "UPDATE sessions SET updated_at='2000-01-01', expires_at=expires_at+interval '1 day' WHERE user_id=$1 RETURNING updated_at > $2::timestamptz AS advanced, created_at=$3::timestamptz AS unchanged",
    [id, original.updated, original.created],
  );
  assert.deepEqual(result.rows[0], { advanced: true, unchanged: true });
});

for (const field of ["user_id", "token_hash", "expires_at"])
  test(`sessions require ${field}`, async (t) => {
    const { client } = await authTransaction(t, pool);
    const id = await fixtureUser(client);
    const entries = Object.entries({
      user_id: id,
      token_hash: "test",
      expires_at: "2030-01-01",
    }).filter(([key]) => key !== field);
    await assert.rejects(
      client.query(
        `INSERT INTO sessions(${entries.map(([key]) => key).join(",")}) VALUES($1,$2)`,
        entries.map(([, value]) => value),
      ),
      { code: "23502", column: field },
    );
  });
test("session token digest must be unique", async (t) => {
  const { client, db } = await authTransaction(t, pool);
  const id = await fixtureUser(client);
  await createSession(db, id);
  await assert.rejects(
    client.query(
      "INSERT INTO sessions(user_id,token_hash,expires_at) SELECT user_id,token_hash,expires_at FROM sessions WHERE user_id=$1",
      [id],
    ),
    { code: "23505" },
  );
});
test("sessions require an existing user", async (t) => {
  const { client } = await authTransaction(t, pool);
  await assert.rejects(
    client.query(
      "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES('00000000-0000-0000-0000-000000000000','test','2030-01-01')",
    ),
    { code: "23503" },
  );
});

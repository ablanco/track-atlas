import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test, type TestContext } from "node:test";
import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createDatabase } from "../../db/client";

loadEnvConfig(process.cwd(), true);
const { pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());

// Encoded-hash-shaped test data only: not a usable credential or a hashing implementation.
const passwordHash = "$argon2id$v=19$m=65536,t=3,p=1$c3ludGhldGljLXNhbHQ$c3ludGhldGljLWhhc2g";

async function transaction(t: TestContext) {
  const client = await pool.connect();
  t.after(async () => {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
  await client.query("BEGIN");
  return client;
}

async function insertUser(
  client: PoolClient,
  overrides: Record<string, unknown> = {},
  omit: string[] = [],
) {
  const values = {
    first_name: "Ada",
    last_name: "Lovelace",
    email: `user-${randomUUID()}@example.test`,
    password_hash: passwordHash,
    date_of_birth: "1815-12-10",
    ...overrides,
  };
  const entries = Object.entries(values).filter(([key]) => !omit.includes(key));
  // Identifiers come only from literal fixtures in this file, never external input.
  const columns = entries.map(([key]) => `"${key}"`).join(", ");
  const params = entries.map((_, index) => `$${index + 1}`).join(", ");
  const result = await client.query(
    `INSERT INTO users (${columns}) VALUES (${params})
     RETURNING *, date_of_birth::text AS birthday,
       created_at::text AS created, updated_at::text AS updated`,
    entries.map(([, value]) => value),
  );
  return result.rows[0];
}

test("inserts a minimal local user with generated defaults", async (t) => {
  const client = await transaction(t);
  const user = await insertUser(client);
  assert.match(user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(user.first_name, "Ada");
  assert.equal(user.last_name, "Lovelace");
  assert.equal(user.active, true);
  assert.equal(user.display_name, null);
  assert.equal(user.avatar_url, null);
  assert.equal(user.birthday, "1815-12-10");
  assert.equal(user.password_hash, passwordHash);
  assert.equal("password" in user, false);
  assert.ok(user.created_at instanceof Date);
  assert.equal(user.created, user.updated);
});

test("round-trips profile fields and allows explicitly disabling a user", async (t) => {
  const client = await transaction(t);
  const user = await insertUser(client, {
    display_name: "Ada",
    avatar_url: "https://example.test/avatars/ada.png",
    active: false,
  });
  assert.equal(user.display_name, "Ada");
  assert.equal(user.avatar_url, "https://example.test/avatars/ada.png");
  assert.equal(user.active, false);
  const other = await insertUser(client, { display_name: "Ada" });
  assert.notEqual(other.id, user.id);
});

for (const field of ["first_name", "last_name", "email", "password_hash", "date_of_birth"]) {
  test(`rejects an omitted required ${field}`, async (t) => {
    const client = await transaction(t);
    await assert.rejects(insertUser(client, {}, [field]), { code: "23502", column: field });
  });
}

for (const field of ["first_name", "last_name", "email", "password_hash"]) {
  for (const value of ["", "   "]) {
    test(`rejects blank ${field} (${JSON.stringify(value)})`, async (t) => {
      const client = await transaction(t);
      await assert.rejects(insertUser(client, { [field]: value }), { code: "23514" });
    });
  }
}

for (const email of [" owner@example.test", "owner@example.test "]) {
  test(`rejects email with surrounding spaces (${JSON.stringify(email)})`, async (t) => {
    const client = await transaction(t);
    await assert.rejects(insertUser(client, { email }), { code: "23514" });
  });
}

for (const active of [true, false]) {
  test(`enforces case-insensitive email uniqueness when original active=${active}`, async (t) => {
    const client = await transaction(t);
    const email = `Owner-${randomUUID()}@example.test`;
    const user = await insertUser(client, { email, active });
    assert.equal(user.email, email);
    await assert.rejects(insertUser(client, { email: email.toLowerCase() }), {
      code: "23505", constraint: "users_email_unique",
    });
  });
}

for (const zone of ["Pacific/Kiritimati", "America/Los_Angeles"]) {
  test(`preserves date of birth as a calendar date in ${zone}`, async (t) => {
    const client = await transaction(t);
    await client.query("SELECT set_config('TimeZone', $1, true)", [zone]);
    const user = await insertUser(client);
    assert.equal(user.birthday, "1815-12-10");
    const { users } = await import("../../db/schema");
    const [selected] = await drizzle({ client }).select().from(users).where(eq(users.id, user.id));
    assert.equal(selected.dateOfBirth, "1815-12-10");
  });
}

test("Drizzle inserts a user with defaults and required date-only mapping", async (t) => {
  const client = await transaction(t);
  // Establish the SQL boundary first so the RED baseline is a missing table.
  await client.query("SELECT id FROM users LIMIT 0");
  const { users } = await import("../../db/schema");
  const [user] = await drizzle({ client }).insert(users).values({
    firstName: "Ada",
    lastName: "Lovelace",
    email: `user-${randomUUID()}@example.test`,
    passwordHash,
    dateOfBirth: "1815-12-10",
  }).returning();
  assert.equal(user.dateOfBirth, "1815-12-10");
  assert.equal(user.active, true);
  assert.equal(user.displayName, null);
  assert.equal(user.avatarUrl, null);
  assert.equal(user.passwordHash, passwordHash);
  assert.ok(user.createdAt instanceof Date);
  assert.ok(user.updatedAt instanceof Date);
});

test("database advances modification time for Drizzle and direct SQL updates", async (t) => {
  const client = await transaction(t);
  const user = await insertUser(client);
  const { users } = await import("../../db/schema");
  await drizzle({ client }).update(users).set({ displayName: "Countess" }).where(eq(users.id, user.id));
  const first = await client.query(
    `SELECT created_at = $2::timestamptz AS creation_unchanged,
       updated_at > $3::timestamptz AS modification_advanced,
       updated_at::text AS updated FROM users WHERE id = $1`,
    [user.id, user.created, user.updated],
  );
  assert.equal(first.rows[0].creation_unchanged, true);
  assert.equal(first.rows[0].modification_advanced, true);

  const second = await client.query(
    `UPDATE users SET display_name = 'Ada', updated_at = '2000-01-01T00:00:00Z'
       WHERE id = $1 RETURNING created_at = $2::timestamptz AS creation_unchanged,
       updated_at > $3::timestamptz AS modification_advanced`,
    [user.id, user.created, first.rows[0].updated],
  );
  assert.equal(second.rows[0].creation_unchanged, true);
  assert.equal(second.rows[0].modification_advanced, true);
});

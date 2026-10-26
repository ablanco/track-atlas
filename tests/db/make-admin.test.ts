import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../../db/client";

loadEnvConfig(process.cwd(), true);
const { pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());

function run(args: string[], env = process.env) {
  return spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import=tsx",
      "scripts/make-admin.ts",
      ...args,
    ],
    { encoding: "utf8", env, timeout: 15_000 },
  );
}

for (const args of [[], [" "], ["one@example.test", "two@example.test"]]) {
  test(`rejects invalid arguments before connecting: ${JSON.stringify(args)}`, () => {
    const result = run(args, { ...process.env, DATABASE_URL: "invalid" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Usage: pnpm users:make-admin <email>/);
  });
}

test("reports database failures without exposing connection details", () => {
  const result = run(["user@example.test"], {
    ...process.env,
    DATABASE_URL: "postgresql://private:secret@127.0.0.1:1/unavailable",
  });
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr,
    "Admin promotion failed. Check database configuration.\n",
  );
});

test("promotes only the matching account, preserves other fields, and can repeat", async (t) => {
  const email = `Admin-${randomUUID()}@example.test`;
  const otherEmail = `other-${randomUUID()}@example.test`;
  t.after(() =>
    pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [
      [email, otherEmail],
    ]),
  );
  const { rows: before } = await pool.query(
    `INSERT INTO users (first_name, last_name, email, password_hash, date_of_birth, active)
     VALUES ('Ada', 'Lovelace', $1, 'synthetic-test-hash', '1815-12-10', false),
            ('Other', 'User', $2, 'synthetic-test-hash', '2000-01-01', true)
     RETURNING *`,
    [email, otherEmail],
  );

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = run([` ${email.toUpperCase()} `]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "User is now an admin.\n");
    const { rows: after } = await pool.query(
      "SELECT * FROM users WHERE email = ANY($1::text[])",
      [[email, otherEmail]],
    );
    for (const original of before) {
      const actual = after.find((user) => user.id === original.id);
      assert.deepEqual(actual, {
        ...original,
        admin: original.email === email,
        updated_at: actual.updated_at,
      });
      if (original.email === email) {
        assert.ok(actual.updated_at > original.updated_at);
      } else {
        assert.deepEqual(actual.updated_at, original.updated_at);
      }
    }
  }
});

test("fails for an unknown email", () => {
  const result = run([`missing-${randomUUID()}@example.test`]);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr, "No user found with that email.\n");
});

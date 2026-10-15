import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../db/client";

for (const value of [undefined, "", "   ", "\n\t"]) {
  test(`rejects a missing or blank DATABASE_URL (${JSON.stringify(value)})`, () => {
    assert.throws(() => createDatabase(value), {
      message: "DATABASE_URL is required",
    });
  });
}

test("creates a lazy database pool using the supplied connection URL", async (t) => {
  // No listener exists here: constructing the database must not open a connection.
  const url = "postgresql://test:secret@127.0.0.1:1/test";
  const { db, pool } = createDatabase(url);
  t.after(() => pool.end());

  assert.equal(pool.options.connectionString, url);
  assert.equal(pool.options.connectionTimeoutMillis, 5000);
  assert.equal(pool.totalCount, 0);
  assert.equal(typeof db.execute, "function");
});

const accessorPath = fileURLToPath(new URL("../../db/index.ts", import.meta.url));

test("server accessor is lazy and reuses its pool across development module reloads", () => {
  const result = spawnSync(process.execPath, [
    "--conditions=react-server", "--import=tsx", "--eval",
    `
      const assert = require('node:assert/strict');
      delete process.env.DATABASE_URL;
      process.env.NODE_ENV = 'development';
      const path = ${JSON.stringify(accessorPath)};
      const { getDb } = require(path);
      assert.throws(() => getDb(), { message: 'DATABASE_URL is required' });
      process.env.DATABASE_URL = 'postgresql://test:secret@127.0.0.1:1/test';
      const first = getDb();
      assert.equal(getDb(), first);
      delete require.cache[require.resolve(path)];
      assert.equal(require(path).getDb(), first);
      assert.equal(first.$client.totalCount, 0);
      first.$client.end();
    `,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("database accessor rejects imports outside a server-component environment", () => {
  const result = spawnSync(process.execPath, [
    "--import=tsx", "--eval", `require(${JSON.stringify(accessorPath)})`,
  ], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot be imported from a Client Component module/);
});

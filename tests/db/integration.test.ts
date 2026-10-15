import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { createDatabase } from "../../db/client";

loadEnvConfig(process.cwd(), true);
const { db, pool } = createDatabase(process.env.DATABASE_URL);
after(() => pool.end());

test("executes a SQL query through Drizzle", async () => {
  const result = await db.execute<{ value: number }>(sql`SELECT 1 AS value`);
  assert.equal(result.rows[0].value, 1);
});

test("executes a PostGIS geometry query", async () => {
  const result = await db.execute<{ point: string }>(sql`
    SELECT ST_AsText(ST_SetSRID(ST_MakePoint(1, 2), 4326)) AS point
  `);
  assert.equal(result.rows[0].point, "POINT(1 2)");
});

test("records the bootstrap migration exactly once", async () => {
  const migration = await readFile(
    new URL("../../drizzle/0000_enable-postgis.sql", import.meta.url),
    "utf8",
  );
  const hash = createHash("sha256").update(migration).digest("hex");
  const result = await db.execute<{ count: number }>(sql`
    SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
    WHERE hash = ${hash}
  `);
  assert.equal(result.rows[0].count, 1);
});

test("survives an idle connection loss and reconnects without logging credentials", () => {
  const clientPath = fileURLToPath(new URL("../../db/client.ts", import.meta.url));
  const result = spawnSync(process.execPath, [
    "--import=tsx", "--eval",
    `
      const assert = require('node:assert/strict');
      const { createDatabase } = require(${JSON.stringify(clientPath)});
      const { pool } = createDatabase(process.env.DATABASE_URL);
      const { pool: admin } = createDatabase(process.env.DATABASE_URL);
      (async () => {
        try {
          const { rows } = await pool.query('SELECT pg_backend_pid() AS pid');
          const removed = new Promise(resolve => {
            pool.once('remove', () => setImmediate(resolve));
          });
          // Disconnect only this test's idle backend, never another session.
          await admin.query('SELECT pg_terminate_backend($1)', [rows[0].pid]);
          await removed;
          assert.equal((await pool.query('SELECT 1 AS value')).rows[0].value, 1);
        } finally {
          await Promise.all([pool.end(), admin.end()]);
        }
      })().catch(() => { process.exitCode = 1; });
    `,
  ], { encoding: "utf8", timeout: 15_000 });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /Database pool lost an idle connection/);
  assert.ok(!result.stderr.includes(process.env.DATABASE_URL!));
});

import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createDatabase } from "../../db/client";
import { getPublicTrack, listPublicTracks } from "../../tracks/public";

test("public discovery rejects database failures rather than returning unverified content", async () => {
  // Fault injection at the PostgreSQL boundary; no network or application mocks.
  const { db, pool } = createDatabase("postgresql://unused@127.0.0.1:1/unused");
  mock.method(pool, "query", async () => {
    throw Error("Database unavailable");
  });
  try {
    assert.equal(await getPublicTrack(db, "invalid"), null);
    await assert.rejects(
      getPublicTrack(db, "00000000-0000-4000-8000-000000000001"),
    );
    await assert.rejects(listPublicTracks(db));
  } finally {
    await pool.end();
  }
});

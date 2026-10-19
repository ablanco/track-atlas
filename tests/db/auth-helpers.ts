import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "../../db/schema";

export async function authTransaction(t: TestContext, pool: Pool) {
  const client = await pool.connect();
  t.after(async () => {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
  await client.query("BEGIN");
  return { client, db: drizzle({ client, schema }) };
}

export function signupFixture() {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    email: `signup-${randomUUID()}@example.test`,
    dateOfBirth: "1815-12-10",
    displayName: null,
    password: " x ",
  };
}

export async function fixtureUser(client: import("pg").PoolClient) {
  const result = await client.query(
    `INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth) VALUES ('Ada','Lovelace',$1,'synthetic','1815-12-10') RETURNING id`,
    [signupFixture().email],
  );
  return result.rows[0].id as string;
}

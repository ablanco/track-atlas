import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDatabase(connectionString: string | undefined) {
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", () => {
    // pg removes the failed idle client. Do not log its error/client object:
    // it can include connection credentials. Future queries open a new client.
    console.error(
      "Database pool lost an idle connection; future queries will reconnect.",
    );
  });

  return { db: drizzle({ client: pool, schema }), pool };
}

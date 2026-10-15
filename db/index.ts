import "server-only";
import { createDatabase } from "./client";

type DatabaseConnection = ReturnType<typeof createDatabase>;

const globalForDb = globalThis as typeof globalThis & {
  trackAtlasDatabase?: DatabaseConnection;
};

let connection: DatabaseConnection | undefined;

export function getDb() {
  if (process.env.NODE_ENV !== "production") {
    globalForDb.trackAtlasDatabase ??= createDatabase(process.env.DATABASE_URL);
    return globalForDb.trackAtlasDatabase.db;
  }

  connection ??= createDatabase(process.env.DATABASE_URL);
  return connection.db;
}

import type { createDatabase } from "../db/client";

export type Database = ReturnType<typeof createDatabase>["db"];
export type AuthTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export type AuthDatabase = Pick<
  Database,
  "select" | "insert" | "delete" | "transaction"
>;
export type AuthExecutor = Pick<Database, "select" | "insert">;

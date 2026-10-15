import type { createDatabase } from "../db/client";

export type Database = ReturnType<typeof createDatabase>["db"];
export type AuthDatabase = Pick<Database, "select" | "insert" | "transaction">;
export type AuthExecutor = Pick<Database, "select" | "insert">;

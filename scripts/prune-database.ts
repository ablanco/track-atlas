import { loadEnvConfig } from "@next/env";
import { getDb } from "@/db";
import { pruneDatabase } from "../db/prune";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

async function main() {
  if (process.argv.length > 2) throw new Error("Unexpected arguments");
  const db = getDb();
  try {
    process.stdout.write(`${JSON.stringify(await pruneDatabase(db))}\n`);
  } finally {
    await db.$client.end();
  }
}

main().catch(() => {
  process.stderr.write(
    "Database pruning failed. Check configuration and retry; earlier batches may have committed.\n",
  );
  process.exitCode = 1;
});

import { loadEnvConfig } from "@next/env";
import { getDb } from "@/db";
import { cleanupFiles } from "../storage/files";
import { getStorageConfig } from "../storage/config";
import { createObjectStore } from "../storage/objects";

loadEnvConfig(process.cwd(), true);

async function main() {
  const db = getDb();
  try {
    const result = await cleanupFiles({
      db,
      store: createObjectStore(getStorageConfig()),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.failed) process.exitCode = 1;
  } finally {
    await db.$client.end();
  }
}

main().catch(() => {
  process.stderr.write(
    "File cleanup failed. Check database and storage configuration.\n",
  );
  process.exitCode = 1;
});

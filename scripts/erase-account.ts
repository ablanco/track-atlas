import { loadEnvConfig } from "@next/env";
import { getDb } from "@/db";
import {
  accountIdPattern,
  eraseAccount,
  AccountErasureError,
} from "../auth/account-erasure";
import { getStorageConfig } from "../storage/config";
import { createObjectStore } from "../storage/objects";
async function main() {
  const [userId, mode, confirmation, ...extra] = process.argv.slice(2);
  const dryRun = mode === "--dry-run";
  if (
    !userId ||
    !accountIdPattern.test(userId) ||
    extra.length ||
    !(dryRun
      ? confirmation === undefined
      : mode === "--confirm" && confirmation === userId)
  ) {
    process.stderr.write(
      "Usage: pnpm users:erase <account-uuid> --dry-run | <account-uuid> --confirm <same-account-uuid>\n",
    );
    process.exitCode = 1;
    return;
  }
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const db = getDb();
  try {
    const stores = [];
    if (!dryRun) {
      try {
        stores.push(createObjectStore(getStorageConfig()));
      } catch {
        /* Report unconfigured locations as pending; withdraw access regardless. */
      }
    }
    const report = await eraseAccount({
      db,
      userId,
      confirmation,
      dryRun,
      stores,
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.status !== "complete" && report.status !== "dry-run")
      process.exitCode = 2;
  } finally {
    await db.$client.end();
  }
}
main().catch((error: unknown) => {
  const messages = {
    invalidConfirmation: "Invalid account confirmation.",
    notFound: "Account not found; no erasure was performed.",
    lastAdmin: "Cannot erase the last active administrator.",
  };
  process.stderr.write(
    `${error instanceof AccountErasureError ? messages[error.code] : "Account erasure failed. Cleanup may be pending; rerun after checking database and storage configuration."}\n`,
  );
  process.exitCode = 1;
});

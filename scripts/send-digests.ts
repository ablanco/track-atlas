import { loadEnvConfig } from "@next/env";
import { getDb } from "@/db";
import { getEmailConfig } from "../email/config";
import { sendEmail } from "../email/send";
import { processDigests } from "../digests/processor";
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
async function main() {
  if (process.argv.length > 2) throw Error("Unexpected arguments");
  const db = getDb();
  try {
    const config = getEmailConfig();
    process.stdout.write(
      `${JSON.stringify(await processDigests({ db, send: sendEmail, origin: config.origin }))}\n`,
    );
  } finally {
    await db.$client.end();
  }
}
main().catch(() => {
  process.stderr.write(
    "Digest run failed: digestUnavailable. Earlier claims may have committed; retry safely.\n",
  );
  process.exitCode = 1;
});

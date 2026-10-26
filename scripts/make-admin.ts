import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";

async function main() {
  const args = process.argv.slice(2);
  const email = args[0]?.trim();
  if (args.length !== 1 || !email) {
    process.stderr.write("Usage: pnpm users:make-admin <email>\n");
    process.exitCode = 1;
    return;
  }

  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const db = getDb();
  try {
    const [user] = await db
      .update(users)
      .set({ admin: true })
      .where(sql`lower(${users.email}) = lower(${email})`)
      .returning({ id: users.id });

    if (!user) {
      process.stderr.write("No user found with that email.\n");
      process.exitCode = 1;
      return;
    }
    process.stdout.write("User is now an admin.\n");
  } finally {
    await db.$client.end();
  }
}

main().catch(() => {
  process.stderr.write(
    "Admin promotion failed. Check database configuration.\n",
  );
  process.exitCode = 1;
});

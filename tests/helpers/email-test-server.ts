import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { startEmailSink } from "./email-sink";

async function main() {
  loadEnvConfig(process.cwd(), true);
  const sink = await startEmailSink();
  const metadata = process.env.EMAIL_TEST_METADATA;
  if (!metadata) throw Error("Private email test metadata required");
  await mkdir("/tmp/opencode", { recursive: true });
  await writeFile(metadata, JSON.stringify({ url: sink.url, token: sink.token, mode: "capture", appOrigin: "http://127.0.0.1:3100" }), { mode: 0o600 });
  const child = spawn("pnpm", ["exec", "next", "dev", "--port", "3100"], {
    stdio: "inherit", env: { ...process.env, EMAIL_DELIVERY_MODE: "capture", EMAIL_TEST_SINK_URL: sink.url, EMAIL_TEST_SINK_TOKEN: sink.token, APP_ORIGIN: "http://127.0.0.1:3100", EMAIL_RATE_LIMIT_SECRET: "test-only-private-email-rate-limit-key-2026" },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  child.on("exit", async code => { await sink.close(); process.exit(code ?? 0); });
}
void main();

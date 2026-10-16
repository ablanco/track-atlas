import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";

const baseURL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
if (process.env.TEST_BASE_URL && !process.env.EMAIL_TEST_METADATA) throw Error("External browser tests require a compatible private capture harness before any mutation");
if (!process.env.TEST_BASE_URL) process.env.EMAIL_TEST_METADATA ??= `/tmp/opencode/track-atlas-email-${randomUUID()}.json`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.TEST_BASE_URL
    ? undefined
    : {
        command: "pnpm exec tsx tests/helpers/email-test-server.ts",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});

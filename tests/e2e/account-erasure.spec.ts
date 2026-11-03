import { test, expect, selectTheme } from "./fixtures";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { legalDocuments } from "../../legal/documents";
import { solveCaptcha } from "./captcha-helpers";

loadEnvConfig(process.cwd(), true);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("Loopback development database required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const run = promisify(execFile);
const salt = Buffer.alloc(16, 40);
const passwordHash = `$scrypt$v=1$N=32768,r=8,p=3$${salt.toString("base64url")}$${scryptSync("erasure password", salt, 64, { N: 32768, r: 8, p: 3, maxmem: 67108864 }).toString("base64url")}`;
test.afterAll(() => pool.end());
for (const locale of ["en", "es"] as const)
  test(`${locale} pending staff erasure revokes browser access and cannot log in again`, async ({
    page,
    context,
    baseURL,
  }) => {
    const userId = randomUUID(),
      fileId = randomUUID();
    const email = `browser-erasure-${randomUUID()}@example.test`;
    const token = randomBytes(32).toString("base64url");
    const directory = await mkdtemp(
      join(tmpdir(), "atlas-browser-erasure-40-"),
    );
    const location = createHash("sha256")
      .update(JSON.stringify(["local", directory]))
      .digest("hex");
    const env = {
      ...process.env,
      FILE_STORAGE_BACKEND: "local",
      FILE_STORAGE_LOCAL_DIR: directory,
    };
    const command = async (dryRun = false) => {
      try {
        return {
          ...(await run(
            process.execPath,
            [
              "--conditions=react-server",
              "--import=tsx",
              "scripts/erase-account.ts",
              userId,
              ...(dryRun ? ["--dry-run"] : ["--confirm", userId]),
            ],
            { env, timeout: 30000 },
          )),
          exitCode: 0,
        };
      } catch (error) {
        const failure = error as Error & {
          code: number;
          stdout: string;
          stderr: string;
        };
        return {
          exitCode: failure.code,
          stdout: failure.stdout,
          stderr: failure.stderr,
        };
      }
    };
    try {
      await pool.query(
        `INSERT INTO users(id,first_name,last_name,email,password_hash,date_of_birth) VALUES($1,'Erasure','Browser',$2,$3,'2000-01-01')`,
        [userId, email, passwordHash],
      );
      await pool.query(
        `INSERT INTO legal_acceptances(user_id,terms_version,privacy_version,locale) VALUES($1,$2,$3,$4)`,
        [
          userId,
          legalDocuments.terms.currentVersion,
          legalDocuments.privacy.currentVersion,
          locale,
        ],
      );
      await pool.query(
        `INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')`,
        [userId, createHash("sha256").update(token).digest("hex")],
      );
      await pool.query(
        `INSERT INTO stored_files(id,owner_id,purpose,storage_location,object_key,byte_size) VALUES($1::uuid,$2,'gpx',$3,$1::text,100)`,
        [fileId, userId, location],
      );
      await writeFile(join(directory, fileId), "unfinished upload");
      await context.addCookies([
        {
          name: "track_atlas_session",
          value: token,
          url: baseURL!,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      await page.goto(`/${locale}/settings`);
      await expect(page.locator('[name="firstName"]')).toHaveValue("Erasure");
      await selectTheme(page, locale === "en" ? "light" : "dark");
      const dryRun = await command(true);
      expect(dryRun.exitCode).toBe(0);
      expect(JSON.parse(dryRun.stdout).status).toBe("dry-run");
      const pending = await command();
      expect(pending.exitCode).toBe(2);
      expect(JSON.parse(pending.stdout).status).toBe("pending");
      expect(JSON.parse(pending.stdout).files).toBe(1);
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`/${locale}$`));
      await expect(page.locator('[name="firstName"]')).toHaveCount(0);
      const api = await context.request.get(`/api/files/${fileId}`);
      expect(api.status()).toBe(401);
      await page.goto(`/${locale}/legal/privacy`);
      await expect(page.locator("h1")).toBeVisible();
      await page.goto(`/${locale}`);
      await page
        .getByRole("button", {
          name: locale === "en" ? "Log in" : "Iniciar sesión",
          exact: true,
        })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.locator('[name="email"]').fill(email);
      await dialog.locator('[name="password"]').fill("erasure password");
      const proof = await solveCaptcha(page, dialog);
      await dialog
        .getByRole("button", {
          name: locale === "en" ? "Log in" : "Iniciar sesión",
          exact: true,
        })
        .click();
      await expect(dialog.getByRole("alert")).toBeVisible({ timeout: 15000 });
      expect(
        (await pool.query("SELECT id FROM sessions WHERE user_id=$1", [userId]))
          .rowCount,
      ).toBe(0);
      await pool.query("DELETE FROM captcha_uses WHERE challenge_hash=$1", [
        proof,
      ]);
      // Advance only this test reservation's tombstone to exercise the staff resume.
      await pool.query(
        `UPDATE stored_files SET delete_after=now()-interval '1 second' WHERE owner_id=$1`,
        [userId],
      );
      const complete = await command();
      expect(complete.exitCode).toBe(0);
      expect(JSON.parse(complete.stdout).status).toBe("complete");
      expect(
        (await pool.query("SELECT id FROM users WHERE id=$1", [userId]))
          .rowCount,
      ).toBe(0);
    } finally {
      await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [userId]);
      await pool.query("DELETE FROM users WHERE id=$1", [userId]);
      await rm(directory, { recursive: true, force: true });
    }
  });

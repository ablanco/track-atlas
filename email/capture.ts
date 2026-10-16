import "server-only";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { CaptureConfig } from "./config";
import type { EmailMessage, EmailSendResult } from "./types";
export async function captureEmail(config: CaptureConfig, message: EmailMessage): Promise<EmailSendResult> {
  if (process.env.NODE_ENV === "production") return { ok: false, reason: "unavailable" };
  try {
    const messageId = randomUUID();
    if (config.sink) {
      const response = await fetch(config.sink.url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(5000), headers: { authorization: `Bearer ${config.sink.token}`, "content-type": "application/json" }, body: JSON.stringify(message) });
      if (!response.ok) return { ok: false, reason: "unavailable" };
    } else {
      await mkdir(config.directory, { recursive: true, mode: 0o700 });
      const files = (await readdir(config.directory)).filter(f => /^\d+-[a-f0-9-]+\.json$/.test(f)).sort();
      for (const file of files.slice(0, Math.max(0, files.length - 99))) await unlink(join(config.directory, file));
      await writeFile(join(config.directory, `${Date.now()}-${messageId}.json`), JSON.stringify(message), { mode: 0o600, flag: "wx" });
    }
    return { ok: true, messageId };
  } catch { return { ok: false, reason: "unavailable" }; }
}

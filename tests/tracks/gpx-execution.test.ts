import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { processGpx } from "../../tracks/gpx";
import { TrackError } from "../../tracks/validation";

const bytes = Buffer.from(
  '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="1"/></trkseg></trk></gpx>',
);
const timedOut = (error: unknown) =>
  error instanceof TrackError && error.code === "processingTimeout";

// Approved execution-boundary fixtures, not parser replacements: an isolated
// deployment deliberately runs pathological native worker code. The real asset
// is never changed. cwd changes are synchronous and restored before yielding.
async function inDeployment(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "gpx-execution-"));
  await mkdir(join(directory, "tracks"));
  await writeFile(join(directory, "tracks", "gpx-worker.cjs"), source);
  const original = process.cwd();
  try {
    let result: Promise<unknown>;
    try {
      process.chdir(directory);
      result = processGpx(bytes);
    } finally {
      process.chdir(original);
    }
    return await result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  "CPU-bound native worker is interrupted at ten seconds while server remains responsive",
  { timeout: 15_000 },
  async () => {
    const started = performance.now();
    let ticks = 0;
    const interval = setInterval(() => ticks++, 25);
    try {
      await assert.rejects(inDeployment("while (true) {}"), timedOut);
      const elapsed = performance.now() - started;
      assert.ok(
        elapsed >= 9_900 && elapsed < 12_000,
        `deadline elapsed ${elapsed}ms`,
      );
      assert.ok(ticks > 100, `server event loop ticked ${ticks} times`);
    } finally {
      clearInterval(interval);
    }
  },
);

test(
  "native worker's V8 heap exhaustion is bounded and sanitized",
  { timeout: 15_000 },
  async () => {
    await assert.rejects(
      inDeployment(
        "const retained = []; while (true) retained.push(new Array(2 ** 20).fill(123));",
      ),
      timedOut,
    );
  },
);

test("concurrent processing has bounded admission and releases slots after completion", async () => {
  const first = processGpx(bytes);
  const second = processGpx(bytes);
  await assert.rejects(processGpx(bytes), timedOut);
  assert.equal((await first).pointCount, 2);
  assert.equal((await second).pointCount, 2);
  assert.equal((await processGpx(bytes)).pointCount, 2);
});

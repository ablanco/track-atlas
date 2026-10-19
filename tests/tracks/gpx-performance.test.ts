import assert from "node:assert/strict";
import test from "node:test";
import { parseGpx, processGpx } from "../../tracks/gpx";
import { TrackError } from "../../tracks/validation";

function upperLimitFixture(pointCount: number) {
  // Build into a bounded byte buffer instead of retaining 100k template strings.
  const buffer = Buffer.alloc(10 * 1024 * 1024);
  let offset = buffer.write(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg>',
  );
  for (let i = 0; i < pointCount; i++) {
    const lat = (48 + i * 0.000001).toFixed(6);
    const lon = (2 + i * 0.000002).toFixed(6);
    const elevation = 100 + (i % 20);
    const time = new Date(Date.UTC(2024, 0, 1) + i * 1000)
      .toISOString()
      .replace(".000Z", "Z");
    offset += buffer.write(
      `<trkpt lat="${lat}" lon="${lon}"><ele>${elevation}</ele><time>${time}</time></trkpt>`,
      offset,
    );
  }
  offset += buffer.write("</trkseg></trk></gpx>", offset);
  return buffer.subarray(0, offset);
}

test(
  "representative 100k-point recording fits native execution budget without data loss",
  { timeout: 15_000 },
  async (context) => {
    const bytes = upperLimitFixture(100_000);
    const rssBefore = process.memoryUsage().rss;
    let sampledPeakRss = rssBefore;
    const interval = setInterval(
      () =>
        (sampledPeakRss = Math.max(sampledPeakRss, process.memoryUsage().rss)),
      5,
    );
    const started = performance.now();
    try {
      const result = await processGpx(bytes);
      const elapsedMilliseconds = performance.now() - started;
      assert.equal(result.pointCount, 100_000);
      assert.equal(result.geometry.coordinates.length, 100_000);
      assert.equal(result.samples.length, 100_000);
      assert.equal(result.elevationSampleCount, 100_000);
      assert.equal(result.durationSeconds, 99_999);
      assert.equal(result.representations.length, 5);
      assert.deepEqual(
        result.geometry.coordinates.at(-1),
        [2.199998, 48.099999],
      );
      assert.ok(elapsedMilliseconds < 10_000);
      context.diagnostic(
        JSON.stringify({
          inputBytes: bytes.byteLength,
          pointCount: result.pointCount,
          elapsedMilliseconds: Math.round(elapsedMilliseconds),
          rssBeforeMiB: +(rssBefore / 2 ** 20).toFixed(1),
          sampledPeakProcessRssMiB: +(sampledPeakRss / 2 ** 20).toFixed(1),
          lifetimePeakProcessRssMiB: +(
            process.resourceUsage().maxRSS / 1024
          ).toFixed(1),
          serializedResultBytes: Buffer.byteLength(JSON.stringify(result)),
        }),
      );
    } finally {
      clearInterval(interval);
    }
  },
);

test("actual point, byte and XML element ceilings reject rather than truncate", () => {
  assert.throws(
    () => parseGpx(upperLimitFixture(100_001)),
    (error: unknown) =>
      error instanceof TrackError && error.code === "tooManyPoints",
  );
  assert.throws(
    () => parseGpx(Buffer.alloc(10 * 1024 * 1024 + 1)),
    (error: unknown) =>
      error instanceof TrackError && error.code === "tooLarge",
  );
  const envelope =
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">';
  assert.throws(
    () => parseGpx(Buffer.from(envelope + "<x/>".repeat(500_000) + "</gpx>")),
    (error: unknown) =>
      error instanceof TrackError && error.code === "invalidFile",
  );
  const valid = Buffer.from(
    envelope +
      '<trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="1"/></trkseg></trk></gpx>',
  );
  const padding = " ".repeat(10 * 1024 * 1024 - valid.byteLength);
  assert.equal(
    parseGpx(
      Buffer.from(valid.toString().replace("</gpx>", padding + "</gpx>")),
    ).pointCount,
    2,
  );
});

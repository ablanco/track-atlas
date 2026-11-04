import assert from "node:assert/strict";
import test from "node:test";
import { parseGpx, processGpx } from "../../tracks/gpx";
import { TrackError } from "../../tracks/validation";

function upperLimitFixture(pointCount: number, segmentCount = 1) {
  // Build into a bounded byte buffer instead of retaining 100k template strings.
  const buffer = Buffer.alloc(10 * 1024 * 1024);
  let offset = buffer.write(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg>',
  );
  for (let i = 0; i < pointCount; i++) {
    if (i > 0 && i % (pointCount / segmentCount) === 0)
      offset += buffer.write("</trkseg><trkseg>", offset);
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
      assert.equal(result.geometry.coordinates[0].length, 100_000);
      assert.equal(result.samples.length, 100_000);
      assert.equal(result.elevationSampleCount, 100_000);
      assert.equal(result.durationSeconds, 99_999);
      assert.equal(result.representations.length, 5);
      assert.deepEqual(
        result.geometry.coordinates[0].at(-1),
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

test(
  "100 segments and 100k points fit the bounded worker without losing boundaries",
  { timeout: 15_000 },
  async (context) => {
    const bytes = upperLimitFixture(100_000, 100);
    const original = Buffer.from(bytes);
    const started = performance.now();
    const result = await processGpx(bytes);
    const elapsedMilliseconds = performance.now() - started;
    assert.equal(result.pointCount, 100_000);
    assert.equal(result.segmentCount, 100);
    assert.equal(result.geometry.coordinates.length, 100);
    assert.ok(
      result.geometry.coordinates.every((part) => part.length === 1000),
    );
    assert.equal(result.representations.length, 500);
    assert.equal(result.samples.length, 100_000);
    assert.equal(result.durationSeconds, 99_900);
    assert.deepEqual(
      result.segmentStarts,
      Array.from({ length: 100 }, (_, index) => index * 1000),
    );
    for (const start of result.segmentStarts) {
      assert.equal(result.samples[start].speedMps, null);
      if (start)
        assert.equal(
          result.samples[start].distanceMeters,
          result.samples[start - 1].distanceMeters,
        );
    }
    assert.deepEqual(bytes, original);
    assert.ok(elapsedMilliseconds < 10_000);
    context.diagnostic(
      JSON.stringify({
        inputBytes: bytes.byteLength,
        elapsedMilliseconds: Math.round(elapsedMilliseconds),
        serializedResultBytes: Buffer.byteLength(JSON.stringify(result)),
      }),
    );
  },
);

test("100 minimal segments are accepted and the 101st rejects without truncation", async () => {
  const segment =
    '<trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="1"/></trkseg>';
  const fixture = (count: number) =>
    Buffer.from(
      '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk>' +
        segment.repeat(count) +
        "</trk></gpx>",
    );
  const result = await processGpx(fixture(100));
  assert.equal(result.segmentCount, 100);
  assert.equal(result.pointCount, 200);
  assert.equal(result.representations.length, 500);
  assert.deepEqual(
    result.segmentStarts,
    Array.from({ length: 100 }, (_, index) => index * 2),
  );
  for (const read of [parseGpx, processGpx]) {
    await assert.rejects(
      async () => read(fixture(101)),
      (error: unknown) =>
        error instanceof TrackError &&
        error.code === "tooManySegments" &&
        error.segment === undefined,
    );
  }
});

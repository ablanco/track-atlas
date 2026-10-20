import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGpx } from "../../tracks/gpx";
import {
  downsampleChartSeries,
  prepareTrackCharts,
} from "../../tracks/chart-data";

test("chart contract presents interval-average speed over its preceding recorded edge", () => {
  const result = prepareTrackCharts([
    { distanceMeters: 0, elevationMeters: 10, speedMps: null },
    { distanceMeters: 100, elevationMeters: 20, speedMps: 1 },
    { distanceMeters: 100, elevationMeters: null, speedMps: 0 },
    { distanceMeters: 200, elevationMeters: 5, speedMps: null },
    { distanceMeters: 300, elevationMeters: 30, speedMps: 2 },
  ]);
  assert.deepEqual(result.speed.points, [
    { distanceMeters: 0, value: 3.6 },
    { distanceMeters: 100, value: 3.6 },
    { distanceMeters: 100, value: 0 },
    { distanceMeters: 100, value: 0 },
    { distanceMeters: 100, value: null },
    { distanceMeters: 200, value: null },
    { distanceMeters: 200, value: 7.2 },
    { distanceMeters: 300, value: 7.2 },
  ]);
  assert.deepEqual(
    result.elevation.points.map((point) => point.value),
    [10, 20, null, 5, 30],
  );
});

test("processing and chart contract retain gaps, stopped intervals, and known-answer metrics", () => {
  const gpx = Buffer.from(
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="tests"><trk><trkseg><trkpt lat="0" lon="0"><ele>10</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="0" lon="0.01"><ele>20</ele><time>2026-01-01T00:01:00Z</time></trkpt><trkpt lat="0" lon="0.01"><ele>5</ele><time>2026-01-01T00:02:00Z</time></trkpt></trkseg></trk></gpx>',
  );
  const processed = parseGpx(gpx);
  const chart = prepareTrackCharts(processed.samples);
  assert.equal(processed.durationSeconds, 120);
  assert.equal(processed.ascentMeters, 10);
  assert.equal(processed.descentMeters, 15);
  assert.equal(processed.minElevationMeters, 5);
  assert.equal(processed.maxElevationMeters, 20);
  assert.ok(Math.abs(chart.speed.points[0].value! - 66.7916945) < 0.00001);
  assert.equal(chart.speed.points.at(-1)?.value, 0);
});

const sample = (distanceMeters: number, value: number | null) => ({
  distanceMeters,
  value,
});

test("chart downsampling retains endpoints, extrema, and explicit gaps", () => {
  const input = [
    sample(0, 4),
    sample(1, 5),
    sample(2, 80),
    sample(3, 6),
    sample(4, null),
    sample(5, null),
    sample(6, 7),
    sample(7, -20),
    sample(8, 8),
  ];
  const output = downsampleChartSeries(input, 4);
  assert.deepEqual(output.points, [
    sample(0, 4),
    sample(2, 80),
    sample(3, 6),
    sample(4, null),
    sample(5, null),
    sample(6, 7),
    sample(7, -20),
    sample(8, 8),
  ]);
  assert.equal(output.downsampled, true);
});

test("display envelope retains extrema in each disconnected run, not just the largest run", () => {
  const result = downsampleChartSeries(
    [
      sample(0, 0),
      sample(1, 80),
      sample(2, 2),
      sample(3, null),
      sample(4, 10),
      sample(5, 15),
      sample(6, -30),
      sample(7, 11),
      sample(8, 9),
    ],
    4,
  );
  assert.ok(
    result.points.some(
      (point) => point.distanceMeters === 1 && point.value === 80,
    ),
  );
  assert.ok(
    result.points.some(
      (point) => point.distanceMeters === 5 && point.value === 15,
    ),
  );
  assert.ok(
    result.points.some(
      (point) => point.distanceMeters === 6 && point.value === -30,
    ),
  );
});

test("large speed series never fabricates ramps or holds across omitted interval boundaries", () => {
  const result = prepareTrackCharts(
    Array.from({ length: 1001 }, (_, index) => ({
      distanceMeters: index,
      elevationMeters: null,
      speedMps: index === 0 ? null : index,
    })),
  );
  assert.equal(result.speed.points.length, 2000);
  assert.equal(result.speed.downsampled, false);
  assert.deepEqual(result.speed.points.slice(0, 6), [
    sample(0, 3.6),
    sample(1, 3.6),
    sample(1, 7.2),
    sample(2, 7.2),
    sample(2, 10.8),
    sample(3, 10.8),
  ]);
});

test("consecutive identical speed or missing intervals coalesce without inventing values", () => {
  const result = prepareTrackCharts([
    { distanceMeters: 0, elevationMeters: null, speedMps: null },
    { distanceMeters: 10, elevationMeters: null, speedMps: 1 },
    { distanceMeters: 20, elevationMeters: null, speedMps: 1 },
    { distanceMeters: 30, elevationMeters: null, speedMps: null },
    { distanceMeters: 40, elevationMeters: null, speedMps: null },
    { distanceMeters: 50, elevationMeters: null, speedMps: 2 },
  ]);
  assert.deepEqual(result.speed.points, [
    sample(0, 3.6),
    sample(20, 3.6),
    sample(20, null),
    sample(40, null),
    sample(40, 7.2),
    sample(50, 7.2),
  ]);
});

test("series below the display limit remains byte-for-byte equivalent", () => {
  const input = [sample(0, 0), sample(1, null), sample(2, 3)];
  assert.deepEqual(downsampleChartSeries(input, 10), {
    points: input,
    downsampled: false,
  });
});

test("long chart input is bounded while retaining global extrema and all gap locations", () => {
  const input = Array.from({ length: 100_000 }, (_, index) =>
    sample(
      index,
      index === 4137 ? 99_999 : index % 701 === 0 ? null : Math.sin(index),
    ),
  );
  const output = downsampleChartSeries(input, 300);
  assert.ok(output.points.length <= 300 + 6 * Math.ceil(100_000 / 701));
  assert.ok(output.points.some((point) => point.value === 99_999));
  assert.equal(
    output.points.filter((point) => point.value === null).length,
    Math.ceil(100_000 / 701),
  );
  assert.equal(output.points[0].distanceMeters, 0);
  assert.equal(output.points.at(-1)?.distanceMeters, 99_999);
  assert.equal(output.downsampled, true);
});

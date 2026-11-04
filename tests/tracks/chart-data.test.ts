import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGpx } from "../../tracks/gpx";
import {
  downsampleChartSeries,
  getChartSection,
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
    boundaries: [],
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

test("segment breaks retain both elevations and separate equal-speed intervals", () => {
  const result = prepareTrackCharts(
    [
      { distanceMeters: 0, elevationMeters: 10, speedMps: null },
      { distanceMeters: 100, elevationMeters: 20, speedMps: 1 },
      { distanceMeters: 100, elevationMeters: 80, speedMps: null },
      { distanceMeters: 200, elevationMeters: 90, speedMps: 1 },
    ],
    [0, 2],
  );
  assert.deepEqual(result.elevation.points, [
    sample(0, 10),
    sample(100, 20),
    { ...sample(100, null), boundarySegment: 2 },
    sample(100, 80),
    sample(200, 90),
  ]);
  assert.deepEqual(result.speed.points, [
    sample(0, 3.6),
    sample(100, 3.6),
    { ...sample(100, null), boundarySegment: 2 },
    sample(100, 3.6),
    sample(200, 3.6),
  ]);
  assert.deepEqual(result.elevation.boundaries, [
    { segment: 2, distanceMeters: 100 },
  ]);
  assert.deepEqual(result.speed.boundaries, result.elevation.boundaries);
});

test("envelopes retain a break's endpoint measurements even beside missing elevation", () => {
  const samples = Array.from({ length: 4000 }, (_, i) => ({
    distanceMeters: i < 2000 ? i : i - 1,
    elevationMeters: i >= 1998 && i <= 2001 ? null : 10,
    speedMps: null,
  }));
  const result = prepareTrackCharts(samples, [0, 2000]);
  assert.deepEqual(
    result.elevation.points.filter((p) => p.distanceMeters === 1999),
    [
      sample(1999, null),
      { ...sample(1999, null), boundarySegment: 2 },
      sample(1999, null),
    ],
  );
});

test("chart pagination keeps the complete break and describes it in both neighboring sections", () => {
  const points = Array.from({ length: 3200 }, (_, i) => sample(i, i));
  points.splice(1598, 0, sample(1597, null), sample(1597, 90));
  const series = {
    points,
    downsampled: false,
    boundaries: [{ segment: 2, distanceMeters: 1597 }],
  };
  const first = getChartSection(series, 0);
  const second = getChartSection(series, 1);
  assert.deepEqual(first.points.slice(-3), [
    sample(1597, 1597),
    sample(1597, null),
    sample(1597, 90),
  ]);
  assert.deepEqual(second.points.slice(0, 3), first.points.slice(-3));
  assert.deepEqual(first.boundaries, series.boundaries);
  assert.deepEqual(second.boundaries, series.boundaries);
  assert.ok(second.points.length <= 1600);
});

test("chart separators identify segment breaks separately from unavailable measurements", () => {
  const result = prepareTrackCharts(
    [
      { distanceMeters: 0, elevationMeters: null, speedMps: null },
      { distanceMeters: 10, elevationMeters: null, speedMps: null },
      { distanceMeters: 10, elevationMeters: null, speedMps: null },
      { distanceMeters: 20, elevationMeters: null, speedMps: null },
    ],
    [0, 2],
  );
  assert.deepEqual(result.elevation.points[2], {
    distanceMeters: 10,
    value: null,
    boundarySegment: 2,
  });
  assert.deepEqual(result.speed.points[2], {
    distanceMeters: 10,
    value: null,
    boundarySegment: 2,
  });
  assert.equal(result.elevation.points[1].boundarySegment, undefined);
  assert.equal(result.elevation.points[3].boundarySegment, undefined);
});

test("100 segment boundaries survive a 100k-point envelope without joining chart runs", () => {
  const samples = Array.from({ length: 100_000 }, (_, i) => ({
    distanceMeters: i - Math.floor(i / 1000),
    elevationMeters: i % 1000,
    speedMps: i % 1000 === 0 ? null : 1,
  }));
  const result = prepareTrackCharts(
    samples,
    Array.from({ length: 100 }, (_, i) => i * 1000),
  );
  for (const series of [result.elevation, result.speed]) {
    assert.equal(series.boundaries.length, 99);
    assert.equal(
      series.points.filter((p) => p.boundarySegment !== undefined).length,
      99,
    );
    const separator = series.points.findIndex((p) => p.boundarySegment === 100);
    assert.equal(series.points[separator - 1].distanceMeters, 98901);
    assert.equal(series.points[separator + 1].distanceMeters, 98901);
    assert.equal(series.points[separator].value, null);
  }
  assert.deepEqual(result.elevation.points.at(-1), sample(99900, 999));
});

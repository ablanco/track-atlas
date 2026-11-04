import type { TrackSample } from "./geometry";
export type { TrackSample } from "./geometry";
export type ChartPoint = {
  distanceMeters: number;
  value: number | null;
  /** A plotted break, distinct from an unavailable recorded measurement. */
  boundarySegment?: number;
};
export type ChartSeries = {
  points: ChartPoint[];
  downsampled: boolean;
  boundaries: ChartBoundary[];
};
export type ChartBoundary = { segment: number; distanceMeters: number };
/**
 * Display-only min/max envelope: bucket endpoints/extrema, every contiguous
 * run's endpoints, and gap boundaries are retained. Arbitrarily many gaps may
 * exceed the target; the client then renders bounded, navigable sections.
 * Source samples, geometry and full-data metrics are never changed.
 */
export function downsampleChartSeries(
  points: ChartPoint[],
  maxPoints = 1600,
  boundaries: ChartBoundary[] = [],
): ChartSeries {
  if (points.length <= maxPoints || points.length < 3)
    return { points, downsampled: false, boundaries };

  const bucketCount = Math.max(1, Math.floor(maxPoints / 4));
  const bucketSize = Math.ceil(points.length / bucketCount);
  const selected = new Set<number>([0, points.length - 1]);
  const boundaryDistances = new Set(
    boundaries.map((boundary) => boundary.distanceMeters),
  );
  points.forEach((point, index) => {
    if (boundaryDistances.has(point.distanceMeters)) selected.add(index);
  });

  for (let start = 0; start < points.length; start += bucketSize) {
    const end = Math.min(points.length, start + bucketSize);
    let minimum = -1;
    let maximum = -1;
    const retainExtrema = () => {
      if (minimum >= 0) {
        selected.add(minimum);
        selected.add(maximum);
      }
      minimum = maximum = -1;
    };
    for (let index = start; index < end; index++) {
      const value = points[index].value;
      // Keep both sides of each gap, including the run boundary itself.
      if (
        (index > 0 &&
          (value === null) !== (points[index - 1].value === null)) ||
        (index + 1 < points.length &&
          (value === null) !== (points[index + 1].value === null))
      )
        selected.add(index);
      if (value === null) {
        retainExtrema();
        continue;
      }
      if (minimum < 0 || value < points[minimum].value!) minimum = index;
      if (maximum < 0 || value > points[maximum].value!) maximum = index;
    }
    retainExtrema();
    selected.add(start);
    selected.add(end - 1);
  }
  const reduced = [...selected]
    .sort((a, b) => a - b)
    .map((index) => points[index]);
  return {
    points: reduced,
    downsampled: reduced.length < points.length,
    boundaries,
  };
}

/** Chart presentation contract: no geometry or GPX extension telemetry. */
export function prepareTrackCharts(
  samples: TrackSample[],
  segmentStarts: number[] = [0],
): {
  elevation: ChartSeries;
  speed: ChartSeries;
} {
  const starts = new Set(segmentStarts.slice(1));
  const boundaries = segmentStarts.slice(1).map((index, segment) => ({
    segment: segment + 2,
    distanceMeters: samples[index].distanceMeters,
  }));
  const elevation: ChartPoint[] = [];
  const boundaryNumbers = new Map(
    segmentStarts.map((index, segment) => [index, segment + 1]),
  );
  samples.forEach((sample, index) => {
    if (starts.has(index))
      elevation.push({
        distanceMeters: sample.distanceMeters,
        value: null,
        boundarySegment: boundaryNumbers.get(index),
      });
    elevation.push({
      distanceMeters: sample.distanceMeters,
      value: sample.elevationMeters,
    });
  });
  const speed: ChartPoint[] = [];
  for (let index = 1; index < samples.length; index++) {
    if (starts.has(index)) {
      speed.push({
        distanceMeters: samples[index].distanceMeters,
        value: null,
        boundarySegment: boundaryNumbers.get(index),
      });
      continue;
    }
    const value = samples[index].speedMps;
    const kmh = value === null ? null : value * 3.6;
    // A speed belongs to the preceding interval, not an instantaneous point.
    // Two positions show even a single usable interval, including stopped edges.
    const previous = speed.at(-1);
    if (previous && previous.value === kmh && !starts.has(index - 1)) {
      // Extending an identical constant (or missing) interval is exact, not
      // smoothing: preserve its start and move only the end boundary.
      previous.distanceMeters = samples[index].distanceMeters;
    } else {
      speed.push(
        { distanceMeters: samples[index - 1].distanceMeters, value: kmh },
        { distanceMeters: samples[index].distanceMeters, value: kmh },
      );
    }
  }
  return {
    elevation: downsampleChartSeries(elevation, 1600, boundaries),
    // Keep every speed interval boundary: an envelope followed by linear or
    // step interpolation would fabricate speeds across omitted intervals.
    // Rendering is bounded by client-side section navigation instead.
    speed: { points: speed, downsampled: false, boundaries },
  };
}

/** Overlap a complete endpoint/separator/endpoint triple at section edges. */
export function getChartSection(
  series: ChartSeries,
  section: number,
  size = 1600,
) {
  const stride = Math.max(1, size - 3);
  const count = Math.max(1, Math.ceil((series.points.length - 3) / stride));
  const offset = Math.min(Math.max(0, section), count - 1) * stride;
  const points = series.points.slice(offset, offset + size);
  const boundaries = series.boundaries.filter(
    (boundary) =>
      points.length > 0 &&
      boundary.distanceMeters >= points[0].distanceMeters &&
      boundary.distanceMeters <= points.at(-1)!.distanceMeters,
  );
  return { points, boundaries, count };
}

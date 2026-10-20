export type ChartPoint = { distanceMeters: number; value: number | null };
export type ChartSeries = { points: ChartPoint[]; downsampled: boolean };
export type TrackSample = {
  distanceMeters: number;
  elevationMeters: number | null;
  speedMps: number | null;
};

/**
 * Display-only min/max envelope: bucket endpoints/extrema, every contiguous
 * run's endpoints, and gap boundaries are retained. Arbitrarily many gaps may
 * exceed the target; the client then renders bounded, navigable sections.
 * Source samples, geometry and full-data metrics are never changed.
 */
export function downsampleChartSeries(
  points: ChartPoint[],
  maxPoints = 1600,
): ChartSeries {
  if (points.length <= maxPoints || points.length < 3)
    return { points, downsampled: false };

  const bucketCount = Math.max(1, Math.floor(maxPoints / 4));
  const bucketSize = Math.ceil(points.length / bucketCount);
  const selected = new Set<number>([0, points.length - 1]);

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
  return { points: reduced, downsampled: reduced.length < points.length };
}

/** Chart presentation contract: no geometry or GPX extension telemetry. */
export function prepareTrackCharts(samples: TrackSample[]): {
  elevation: ChartSeries;
  speed: ChartSeries;
} {
  const elevation = samples.map((sample) => ({
    distanceMeters: sample.distanceMeters,
    value: sample.elevationMeters,
  }));
  const speed: ChartPoint[] = [];
  for (let index = 1; index < samples.length; index++) {
    const value = samples[index].speedMps;
    const kmh = value === null ? null : value * 3.6;
    // A speed belongs to the preceding interval, not an instantaneous point.
    // Two positions show even a single usable interval, including stopped edges.
    const previous = speed.at(-1);
    if (previous && previous.value === kmh) {
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
    elevation: downsampleChartSeries(elevation),
    // Keep every speed interval boundary: an envelope followed by linear or
    // step interpolation would fabricate speeds across omitted intervals.
    // Rendering is bounded by client-side section navigation instead.
    speed: { points: speed, downsampled: false },
  };
}

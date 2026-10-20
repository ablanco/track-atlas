/** Presentation only: persisted full-data metrics remain the source of truth. */
export function formatTrackDistance(meters: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: meters < 1000 ? "meter" : "kilometer",
    maximumFractionDigits: meters < 1000 ? 1 : 2,
  }).format(meters < 1000 ? meters : meters / 1000);
}

export function formatTrackElevation(meters: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "meter",
    maximumFractionDigits: 1,
  }).format(meters);
}

/** Elapsed recorded time, not a wall-clock Date or inferred moving time. */
export function formatRecordedDuration(
  seconds: number,
  locale: string,
): string {
  // Round once before splitting so carries never produce a displayed 60 seconds.
  const rounded = Math.round(seconds * 100) / 100;
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = Math.round((rounded % 60) * 100) / 100;
  const parts: [number, "hour" | "minute" | "second"][] = [
    [hours, "hour"],
    [minutes, "minute"],
    [remainder, "second"],
  ];
  return parts
    .filter(
      ([value, unit]) => value > 0 || (rounded === 0 && unit === "second"),
    )
    .map(([value, unit]) =>
      new Intl.NumberFormat(locale, {
        style: "unit",
        unit,
        unitDisplay: "long",
        maximumFractionDigits: 2,
      }).format(value),
    )
    .join(", ");
}

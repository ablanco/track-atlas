import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatTrackDistance,
  formatTrackElevation,
  formatRecordedDuration,
} from "../../tracks/format";

for (const locale of ["en", "es"]) {
  test(`${locale}: localized distance switches units without losing short tracks`, () => {
    assert.equal(
      formatTrackDistance(12.5, locale),
      locale === "en" ? "12.5 m" : "12,5 m",
    );
    assert.equal(
      formatTrackDistance(1234, locale),
      locale === "en" ? "1.23 km" : "1,23 km",
    );
    assert.equal(formatTrackElevation(0, locale), "0 m");
    assert.equal(
      formatTrackElevation(-12.5, locale),
      locale === "en" ? "-12.5 m" : "-12,5 m",
    );
  });
  test(`${locale}: recorded duration is elapsed time including days, not a Date`, () => {
    assert.equal(
      formatRecordedDuration(90061, locale),
      locale === "en"
        ? "25 hours, 1 minute, 1 second"
        : "25 horas, 1 minuto, 1 segundo",
    );
    assert.equal(
      formatRecordedDuration(0.25, locale),
      locale === "en" ? "0.25 seconds" : "0,25 segundos",
    );
    assert.equal(
      formatRecordedDuration(59.999, locale),
      locale === "en" ? "1 minute" : "1 minuto",
    );
  });
}

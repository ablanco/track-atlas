import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { ExploreFilters } from "./explore-types";

/** Candidate scans use persisted representation indexes, exact tests use its vertices/edges. */
export function exploreSpatialPredicates(filters: ExploreFilters): SQL[] {
  const predicates: SQL[] = [];
  const viewport = filters.viewport;
  if (viewport) {
    const { west, south, east, north } = viewport;
    const ranges =
      west > east
        ? [
            [west, 180],
            [-180, east],
          ]
        : [[west, east]];
    // The date-line meridian has two valid coordinate spellings in stored paths.
    if (west === -180) ranges.push([180, 180]);
    if (east === 180) ranges.push([-180, -180]);
    const boxes = ranges.map(
      ([w, e]) => sql`ST_MakeEnvelope(${w},${south},${e},${north},4326)`,
    );
    predicates.push(sql`t.id IN (
      WITH spatial_candidates AS MATERIALIZED (SELECT r.track_id FROM track_directional_representations r
      WHERE r.intermediate_count=5
      AND (${sql.join(
        boxes.map((box) => sql`r.geometry && ${box}`),
        sql` OR `,
      )})
      AND EXISTS (SELECT 1 FROM ST_DumpPoints(r.geometry) p
        WHERE ${sql.join(
          boxes.map((box) => sql`p.geom && ${box}`),
          sql` OR `,
        )})
      ) SELECT track_id FROM spatial_candidates
    )`);
  }
  const drawing = filters.drawing;
  if (drawing) {
    const start = sql`ST_SetSRID(ST_MakePoint(${drawing.start[0]},${drawing.start[1]}),4326)::geography`;
    const end = sql`ST_SetSRID(ST_MakePoint(${drawing.end[0]},${drawing.end[1]}),4326)::geography`;
    const line = sql`ST_MakeLine(${start}::geometry,${end}::geometry)::geography`;
    const distance = drawing.corridorKm * 1000;
    // Candidate-only 1µm padding protects exact boundary matches from DWithin
    // short-circuit roundoff. The final spheroidal distance has no added allowance.
    // Stabilize geodesic inverse roundoff to a nanodegree before inclusive comparison.
    predicates.push(sql`t.id IN (
      WITH spatial_candidates AS MATERIALIZED (SELECT r.track_id FROM track_directional_representations r
      WHERE r.intermediate_count=5
      AND ST_DWithin(r.geometry::geography,${line},${distance + 0.000001})
      AND EXISTS (
        SELECT 1 FROM generate_series(1,6) n
        CROSS JOIN LATERAL (SELECT ST_PointN(r.geometry,n)::geography AS a,
          ST_PointN(r.geometry,n+1)::geography AS b) endpoints
        CROSS JOIN LATERAL (SELECT round(degrees(abs(atan2(
          sin(ST_Azimuth(a,b)-ST_Azimuth(${start},${end})),
          cos(ST_Azimuth(a,b)-ST_Azimuth(${start},${end})))))::numeric,9) AS difference) bearing
        WHERE NOT (ST_Y(a::geometry)=ST_Y(b::geometry)
          AND (ST_X(a::geometry)=ST_X(b::geometry)
            OR abs(ST_X(a::geometry)-ST_X(b::geometry))=360
            OR abs(ST_Y(a::geometry))=90))
          AND ST_Azimuth(a,b) IS NOT NULL
          AND ST_Distance(ST_MakeLine(a::geometry,b::geometry)::geography,${line})<=${distance}
          AND (${drawing.mode}='line' AND difference>=150
            OR difference<=30)
      )
      ) SELECT track_id FROM spatial_candidates
    )`);
  }
  return predicates;
}

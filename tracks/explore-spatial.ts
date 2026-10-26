import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { ExploreFilters } from "./explore-types";
import { sampleExplorePath } from "./explore-path";

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
    // Canonicalize an unoriented Line so closest-point ties cannot depend on
    // which endpoint the user placed first. Arrow keeps recorded travel order.
    const reverse =
      drawing.mode === "line" &&
      (drawing.start[0] > drawing.end[0] ||
        (drawing.start[0] === drawing.end[0] &&
          drawing.start[1] > drawing.end[1]));
    const [first, last] = reverse
      ? [drawing.end, drawing.start]
      : [drawing.start, drawing.end];
    const coordinates = sampleExplorePath(first, last).samples.map(
      (p) => p.position,
    );
    // One bounded GeoJSON parameter, parsed once, rather than repeating thousands
    // of point expressions/parameters throughout the candidate and exact tests.
    const path = JSON.stringify({ type: "LineString", coordinates });
    const line = sql`d.path`;
    const distance = drawing.corridorKm * 1000;
    // Candidate-only 1µm padding protects exact boundary matches from DWithin
    // short-circuit roundoff. The final spheroidal distance has no added allowance.
    // Stabilize geodesic inverse roundoff to a nanodegree before inclusive comparison.
    predicates.push(sql`t.id IN (
      WITH drawing_path AS MATERIALIZED (
        SELECT ST_GeomFromGeoJSON(${path})::geography AS path
      ), spatial_candidates AS MATERIALIZED (SELECT r.track_id FROM drawing_path d
      CROSS JOIN track_directional_representations r
      WHERE r.intermediate_count=5
      AND ST_DWithin(r.geometry::geography,${line},${distance + 0.000001})
      AND EXISTS (
        SELECT 1 FROM generate_series(1,6) n
        CROSS JOIN LATERAL (SELECT ST_PointN(r.geometry,n)::geography AS a,
          ST_PointN(r.geometry,n+1)::geography AS b) endpoints
        -- Preserve the native representation arc, but avoid PostGIS selecting
        -- the antipodal intersection of a nearly half-world two-point edge.
        CROSS JOIN LATERAL (SELECT ST_Segmentize(
          ST_MakeLine(a::geometry,b::geometry)::geography,100000) AS edge_path
          OFFSET 0) finite_edge
        CROSS JOIN LATERAL (SELECT ST_ShortestLine(
          edge_path,${line})::geometry AS connector
          OFFSET 0) nearest
        CROSS JOIN LATERAL (SELECT
          ${canonicalPole(sql`ST_StartPoint(connector)::geography`)} AS edge_point,
          ${canonicalPole(sql`ST_EndPoint(connector)::geography`)} AS draw_point) locations
        -- Equal WGS84 piece lengths let the geographic fraction identify the
        -- local piece without planar longitude interpolation across the date line.
        CROSS JOIN LATERAL (SELECT least(${coordinates.length - 1},greatest(1,
          floor(ST_LineLocatePoint(${line},draw_point)*${coordinates.length - 1})::int+1)) AS piece
          OFFSET 0) located
        CROSS JOIN LATERAL (SELECT ST_PointN(${line}::geometry,piece)::geography AS draw_start,
          ST_PointN(${line}::geometry,piece+1)::geography AS draw_end) drawing_piece
        -- Tangents use nearby locations on finite paths. Transport the drawing
        -- heading along their geographic connector into the edge's local frame;
        -- subtracting north-based headings directly fails near/crossing a pole.
        CROSS JOIN LATERAL (SELECT
          ${localTangent(sql`edge_point`, sql`a`, sql`b`)} AS edge_direction,
          ${localTangent(sql`draw_point`, sql`draw_start`, sql`draw_end`)} AS draw_direction,
          CASE WHEN ST_Distance(edge_point,draw_point)=0 THEN 0
            ELSE ST_Azimuth(edge_point,draw_point)
              -ST_Azimuth(draw_point,edge_point)-pi() END AS frame_rotation) tangents
        CROSS JOIN LATERAL (SELECT round(degrees(abs(atan2(
          sin(edge_direction-draw_direction-frame_rotation),
          cos(edge_direction-draw_direction-frame_rotation))))::numeric,9) AS difference) bearing
        WHERE NOT (ST_Y(a::geometry)=ST_Y(b::geometry)
          AND (ST_X(a::geometry)=ST_X(b::geometry)
            OR abs(ST_X(a::geometry)-ST_X(b::geometry))=360
            OR abs(ST_Y(a::geometry))=90))
          AND ST_Azimuth(a,b) IS NOT NULL
          AND ST_Distance(edge_path,${line})<=${distance}
          AND (${drawing.mode}='line' AND difference>=150
            OR difference<=30)
      )
      ) SELECT track_id FROM spatial_candidates
    )`);
  }
  return predicates;
}

/** Give pole aliases one meridian, including for the connector's local frames. */
function canonicalPole(point: SQL): SQL {
  return sql`(CASE WHEN abs(ST_Y(${point}::geometry))=90
    THEN ST_SetSRID(ST_MakePoint(0,ST_Y(${point}::geometry)),4326)::geography
    ELSE ${point} END)`;
}

/** Forward tangent at a nearby location, pointing toward the farther endpoint
 * for numerical stability (and backward from the start when near the end).
 */
function localTangent(point: SQL, start: SQL, end: SQL): SQL {
  return sql`CASE WHEN ST_Distance(${point},${start})>ST_Distance(${point},${end})
    THEN ST_Azimuth(${point},${start})+pi()
    ELSE ST_Azimuth(${point},${end}) END`;
}

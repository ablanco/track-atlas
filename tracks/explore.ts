import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../auth/database";
import { isSessionToken } from "../auth/session-store";
import type { ExploreFilters, ExploreResult } from "./explore-types";
import { parseExploreFilters, serializeExploreFilters } from "./explore-query";
import { avatarVersionKey } from "../storage/avatar-versions";
import type { ObjectStore } from "../storage/objects";
import { listViewer } from "./lists";
import { TrackListError } from "./list-validation";
import { TrackError, trackIdPattern } from "./validation";

type Dependencies = {
  db: Pick<Database, "execute">;
  token: string | undefined;
};
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const sessionHash = (token: string | undefined) =>
  isSessionToken(token) ? digest(token) : "";
// These aliases are private SQL fragments, never caller-selected identifiers.
const ownerIdentity = sql`jsonb_build_object(
  'id',u.id,
  'name',coalesce(nullif(btrim(u.display_name),''),u.first_name || ' ' || left(u.last_name,1) || '.'),
  'avatarUrl',CASE WHEN EXISTS (
    SELECT 1 FROM stored_files a WHERE a.id=u.avatar_file_id AND a.owner_id=u.id
    AND a.purpose='avatar' AND a.status='ready'
    AND a.avatar_128_bytes IS NOT NULL AND a.avatar_128_sha256 IS NOT NULL
  ) THEN '/api/users/' || u.id || '/avatar' ELSE NULL END
)`;

/** Counts, bounds, identities and the page share one authorized statement snapshot. */
export async function getExploreResults({
  db,
  token,
  ownerId,
  listId,
  filters: input,
}: Dependencies & {
  ownerId?: string;
  listId?: string;
  filters: ExploreFilters;
}): Promise<ExploreResult | null> {
  if (ownerId !== undefined && listId !== undefined)
    throw new TrackListError("invalidRequest");
  if (listId !== undefined && !trackIdPattern.test(listId))
    throw new TrackListError("invalidRequest");
  if (ownerId !== undefined && !trackIdPattern.test(ownerId)) return null;
  const filters = parseExploreFilters(serializeExploreFilters(input));
  const hash = sessionHash(token);
  const matches = filters.q
    .split(" ")
    .filter(Boolean)
    .map(
      (word) =>
        sql`(strpos(lower(public.unaccent(t.name)),lower(public.unaccent(${word})))>0 OR EXISTS(SELECT 1 FROM track_tags tag WHERE tag.track_id=t.id AND strpos(lower(public.unaccent(tag.label)),lower(public.unaccent(${word})))>0))`,
    );
  if (filters.activities.length)
    matches.push(
      sql`t.activity IN (${sql.join(
        filters.activities.map((value) => sql`${value}`),
        sql`,`,
      )})`,
    );
  if (filters.difficulties.length)
    matches.push(
      sql`t.difficulty IN (${sql.join(
        filters.difficulties.map((value) => sql`${value}`),
        sql`,`,
      )})`,
    );
  if (filters.minDistanceKm !== null)
    matches.push(sql`t.distance_meters>=${filters.minDistanceKm * 1000}`);
  if (filters.maxDistanceKm !== null)
    matches.push(sql`t.distance_meters<=${filters.maxDistanceKm * 1000}`);
  if (filters.maxElevationRangeMeters !== null)
    matches.push(
      sql`t.elevation_sample_count=t.point_count AND t.max_elevation_meters-t.min_elevation_meters<=${filters.maxElevationRangeMeters}`,
    );
  const predicate = matches.length ? sql.join(matches, sql` AND `) : sql`true`;
  const result = await db.execute<{
    result: ExploreResult;
    viewer: string | null;
  }>(sql`
    WITH viewer AS (${listViewer(token)}), list_scope AS (
      SELECT id,name FROM track_lists WHERE id=${listId ?? null}::uuid AND owner_id=(SELECT id FROM viewer)
    ), collection AS (
      SELECT ${ownerIdentity} || jsonb_build_object('isOwner',EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.token_hash=${hash} AND s.expires_at>statement_timestamp())) AS identity
      FROM users u WHERE u.id=${ownerId ?? null}::uuid AND u.active
    ), base AS MATERIALIZED (
      SELECT t.*, ${ownerIdentity} AS owner,
      CASE WHEN ${listId ?? null}::uuid IS NOT NULL THEN (SELECT m.created_at FROM track_list_memberships m WHERE m.list_id=(SELECT id FROM list_scope) AND m.track_id=t.id) ELSE t.created_at END AS sort_at,
      EXISTS(SELECT 1 FROM track_list_memberships bm JOIN track_lists bl ON bl.id=bm.list_id WHERE bm.track_id=t.id AND bl.owner_id=(SELECT id FROM viewer)) AS is_bookmarked
      FROM tracks t JOIN users u ON u.id=t.owner_id AND u.active
      JOIN stored_files f ON f.id=t.original_file_id AND f.owner_id=t.owner_id AND f.purpose='gpx' AND f.status='ready'
      WHERE (${ownerId ?? null}::uuid IS NULL OR t.owner_id=${ownerId ?? null}::uuid)
      AND (${listId ?? null}::uuid IS NULL OR EXISTS(SELECT 1 FROM track_list_memberships m WHERE m.list_id=(SELECT id FROM list_scope) AND m.track_id=t.id))
      AND (t.visibility='public' OR (${listId ?? null}::uuid IS NOT NULL AND t.owner_id=(SELECT id FROM viewer)) OR (${ownerId ?? null}::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.token_hash=${hash} AND s.expires_at>statement_timestamp())))
    ), matched AS MATERIALIZED (SELECT t.* FROM base t WHERE ${predicate}
        AND (${filters.visibility}='all' OR (${listId ?? null}::uuid IS NULL AND NOT coalesce((SELECT (identity->>'isOwner')::boolean FROM collection),false)) OR t.visibility=${filters.visibility})), stats AS (
      SELECT count(*)::int AS count,coalesce(max(distance_meters)/1000,0) AS distance,
        coalesce(max(max_elevation_meters-min_elevation_meters) FILTER (WHERE elevation_sample_count=point_count),0) AS elevation FROM base
    ), totals AS (SELECT count(*)::int AS total,greatest(1,ceil(count(*)/10.0)::int) AS pages FROM matched),
    paging AS (SELECT total,pages,least(${filters.page},pages) AS page FROM totals),
    page_tracks AS (SELECT * FROM matched ORDER BY sort_at DESC,id DESC LIMIT 10 OFFSET (SELECT (page-1)*10 FROM paging))
    SELECT jsonb_build_object('tracks',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'activity',activity,'difficulty',difficulty,'distanceMeters',distance_meters,'visibility',visibility,'owner',owner,'isBookmarked',is_bookmarked) ORDER BY sort_at DESC,id DESC) FROM page_tracks),'[]'::jsonb),'total',paging.total,'scopeCount',stats.count,'page',paging.page,'pageCount',paging.pages,'bounds',jsonb_build_object('maxDistanceKm',stats.distance,'maxElevationRangeMeters',stats.elevation),'collection',(SELECT identity FROM collection),'list',(SELECT jsonb_build_object('id',id,'name',name) FROM list_scope)) AS result,(SELECT id FROM viewer) AS viewer FROM stats CROSS JOIN paging
  `);
  const data = result.rows[0].result;
  if (listId !== undefined) {
    if (!result.rows[0].viewer) throw new TrackListError("unauthorized");
    if (!data.list) return null;
  }
  if (ownerId !== undefined && !data.collection) return null;
  return {
    ...data,
    filters: {
      ...filters,
      visibility:
        listId !== undefined || data.collection?.isOwner
          ? filters.visibility
          : "all",
      page: data.page,
    },
  };
}

type Geometry = { type: "LineString"; coordinates: [number, number][] };
/** Dedicated display geometry. Recorded samples and directional representations are untouched. */
export async function getExploreGeometry({
  db,
  token,
  id,
}: Dependencies & { id: string }): Promise<{ geometry: Geometry } | null> {
  if (!trackIdPattern.test(id)) return null;
  const result = await db.execute<{ geometry: Geometry }>(sql`
    WITH RECURSIVE recorded AS MATERIALIZED (
    SELECT d.geometry
    FROM tracks t JOIN users u ON u.id=t.owner_id AND u.active
    JOIN stored_files f ON f.id=t.original_file_id AND f.owner_id=t.owner_id AND f.purpose='gpx' AND f.status='ready'
    JOIN track_data d ON d.track_id=t.id
    WHERE t.id=${id}::uuid AND (t.visibility='public' OR EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.token_hash=${sessionHash(token)} AND s.expires_at>statement_timestamp()))
    ), unwrapped AS MATERIALIZED (
      SELECT CASE WHEN ST_XMax(geometry::box3d)-ST_XMin(geometry::box3d)>180 THEN (
        SELECT ST_SetSRID(ST_MakeLine(ST_MakePoint(lon+360*world,lat) ORDER BY n),4326)
        FROM (
          SELECT n,lon,lat,sum(coalesce(floor((previous-lon)/360+0.5),0)) OVER (ORDER BY n) AS world
          FROM (
            SELECT n,lon,lat,lag(lon) OVER (ORDER BY n) AS previous
            FROM (SELECT p.path[1] AS n,ST_X(p.geom) AS lon,ST_Y(p.geom) AS lat FROM ST_DumpPoints(recorded.geometry) p) points
          ) deltas
        ) worlds
      ) ELSE geometry END AS geometry FROM recorded
    ), display AS (
      SELECT 0.00001::double precision AS tolerance,
        greatest(ST_XMax(geometry::box3d)-ST_XMin(geometry::box3d),ST_YMax(geometry::box3d)-ST_YMin(geometry::box3d)) AS extent,
        ST_Simplify(geometry,0.00001,true) AS geometry FROM unwrapped
      UNION ALL
      SELECT tolerance*2,extent,ST_Simplify(geometry,tolerance*2,true) FROM display
        WHERE ST_NPoints(ST_Segmentize(geometry,90))>2048 AND tolerance<extent
    )
    SELECT ST_AsGeoJSON(ST_Segmentize(geometry,90),17)::jsonb AS geometry FROM display ORDER BY tolerance DESC LIMIT 1
  `);
  const data = result.rows[0];
  if (!data) return null;
  if (data.geometry.coordinates.length > 2048)
    throw new TrackError("unavailable");
  // Segmentize before wrapping so no simplified edge changes world/direction.
  data.geometry.coordinates = data.geometry.coordinates.map(([lon, lat]) => [
    lon >= -180 && lon <= 180 ? lon : lon - 360 * Math.floor((lon + 180) / 360),
    lat,
  ]);
  return data;
}

/** Collection identity is public for active accounts, even with no public tracks. */
export async function downloadCollectionAvatar({
  db,
  ownerId,
  store,
}: {
  db: Pick<Database, "execute">;
  ownerId: string;
  store: ObjectStore;
}): Promise<{ bytes: Buffer }> {
  if (!trackIdPattern.test(ownerId)) throw new TrackError("notFound");
  const read = async () =>
    (
      await db.execute<{
        id: string;
        location: string;
        size: number;
        sha256: string;
      }>(sql`
    SELECT f.id,f.storage_location AS location,f.avatar_128_bytes AS size,f.avatar_128_sha256 AS sha256
    FROM users u JOIN stored_files f ON f.id=u.avatar_file_id AND f.owner_id=u.id AND f.purpose='avatar' AND f.status='ready'
    WHERE u.id=${ownerId}::uuid AND u.active AND f.avatar_128_bytes IS NOT NULL AND f.avatar_128_sha256 IS NOT NULL
  `)
    ).rows[0];
  const file = await read();
  if (!file) throw new TrackError("notFound");
  if (file.location !== store.location) throw new TrackError("unavailable");
  const bytes = await store.get(avatarVersionKey(file.id, 128), file.size);
  if (!bytes || bytes.length !== file.size || digest(bytes) !== file.sha256)
    throw new TrackError("unavailable");
  const current = await read();
  if (
    !current ||
    current.id !== file.id ||
    current.sha256 !== file.sha256 ||
    current.size !== file.size ||
    current.location !== file.location
  )
    throw new TrackError("notFound");
  return { bytes };
}

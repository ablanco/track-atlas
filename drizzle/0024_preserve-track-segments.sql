-- Immutable, bounded validation of recorded part/sample offsets; no re-derivation.
CREATE FUNCTION public.valid_track_segments(path geometry, starts jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE parts integer := ST_NumGeometries(path); offset_count integer := 0; part geometry;
BEGIN
  IF jsonb_typeof(starts) <> 'array' OR parts NOT BETWEEN 1 AND 100 OR jsonb_array_length(starts) <> parts THEN RETURN false; END IF;
  FOR i IN 1..parts LOOP
    part := ST_GeometryN(path,i);
    IF ST_IsEmpty(part) OR ST_NPoints(part) < 2 OR starts->(i-1) IS DISTINCT FROM to_jsonb(offset_count) THEN RETURN false; END IF;
    offset_count := offset_count + ST_NPoints(part);
  END LOOP;
  RETURN true;
END; $$;
--> statement-breakpoint
ALTER TABLE "track_data" DROP CONSTRAINT "track_data_samples_check";--> statement-breakpoint
ALTER TABLE "track_directional_representations" DROP CONSTRAINT "track_representations_values_check";--> statement-breakpoint
ALTER TABLE "tracks" DROP CONSTRAINT "tracks_classification_check";--> statement-breakpoint
ALTER TABLE "tracks" DROP CONSTRAINT "tracks_metrics_check";--> statement-breakpoint
ALTER TABLE "track_directional_representations" DROP CONSTRAINT "track_directional_representations_track_id_intermediate_count_pk";--> statement-breakpoint
ALTER TABLE "track_data" ALTER COLUMN "geometry" SET DATA TYPE geometry(MultiLineString,4326) USING ST_Multi(geometry);--> statement-breakpoint
ALTER TABLE "track_data" ADD COLUMN "segment_starts" jsonb DEFAULT '[0]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "track_directional_representations" ADD COLUMN "segment_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "segment_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "track_directional_representations" ADD CONSTRAINT "track_directional_representations_track_id_segment_index_intermediate_count_pk" PRIMARY KEY("track_id","segment_index","intermediate_count");--> statement-breakpoint
ALTER TABLE "track_data" ADD CONSTRAINT "track_data_samples_check" CHECK (jsonb_typeof("track_data"."samples") = 'array' AND jsonb_array_length("track_data"."samples") = ST_NPoints("track_data"."geometry") AND ST_NPoints("track_data"."geometry") BETWEEN 2 AND 100000 AND NOT ST_IsEmpty("track_data"."geometry") AND public.valid_track_segments("track_data"."geometry", "track_data"."segment_starts"));--> statement-breakpoint
ALTER TABLE "track_directional_representations" ADD CONSTRAINT "track_representations_values_check" CHECK ("track_directional_representations"."segment_index" BETWEEN 0 AND 99 AND "track_directional_representations"."intermediate_count" IN (0,1,3,4,5) AND "track_directional_representations"."version" IN (1,2) AND ST_NPoints("track_directional_representations"."geometry") = "track_directional_representations"."intermediate_count" + 2 AND jsonb_typeof("track_directional_representations"."directionless_edges") = 'array' AND jsonb_array_length("track_directional_representations"."directionless_edges") = "track_directional_representations"."intermediate_count" + 1);--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_classification_check" CHECK ("tracks"."difficulty" BETWEEN 1 AND 5 AND "tracks"."visibility" IN ('private', 'public') AND "tracks"."version" IN (1,2));--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_metrics_check" CHECK ("tracks"."segment_count" BETWEEN 1 AND 100 AND ("tracks"."version" <> 1 OR "tracks"."segment_count" = 1) AND "tracks"."point_count" BETWEEN 2 * "tracks"."segment_count" AND 100000 AND "tracks"."distance_meters" > 0 AND "tracks"."distance_meters" < 'Infinity'::float8 AND "tracks"."elevation_sample_count" BETWEEN 0 AND "tracks"."point_count" AND ("tracks"."duration_seconds" IS NULL OR ("tracks"."duration_seconds" > 0 AND "tracks"."duration_seconds" < 'Infinity'::float8)) AND ("tracks"."ascent_meters" IS NULL OR ("tracks"."ascent_meters" >= 0 AND "tracks"."ascent_meters" < 'Infinity'::float8)) AND ("tracks"."descent_meters" IS NULL OR ("tracks"."descent_meters" >= 0 AND "tracks"."descent_meters" < 'Infinity'::float8)) AND ("tracks"."min_elevation_meters" IS NULL OR ("tracks"."min_elevation_meters" > '-Infinity'::float8 AND "tracks"."min_elevation_meters" < 'Infinity'::float8)) AND ("tracks"."max_elevation_meters" IS NULL OR ("tracks"."max_elevation_meters" > '-Infinity'::float8 AND "tracks"."max_elevation_meters" < 'Infinity'::float8)));
--> statement-breakpoint
-- Tags are optional; supplied tags must still be contiguous and bounded.
CREATE OR REPLACE FUNCTION public.assert_complete_track(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t public.tracks%ROWTYPE; f public.stored_files%ROWTYPE; tag_count integer; first_tag integer; last_tag integer;
BEGIN
  SELECT * INTO t FROM public.tracks WHERE id = target;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO f FROM public.stored_files WHERE id = t.original_file_id FOR UPDATE;
  IF NOT FOUND OR f.owner_id <> t.owner_id OR f.purpose <> 'gpx' OR f.status <> 'ready' THEN
    RAISE EXCEPTION 'Track original must be an owned ready GPX' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.track_data WHERE track_id = target AND ST_NPoints(geometry) = t.point_count AND ST_NumGeometries(geometry) = t.segment_count) OR
     (SELECT count(*) FROM public.track_directional_representations WHERE track_id = target AND version = t.version) <> 5 * t.segment_count OR
     EXISTS (SELECT 1 FROM public.track_directional_representations WHERE track_id = target AND (segment_index >= t.segment_count OR version <> t.version)) THEN
    RAISE EXCEPTION 'Track derived records are incomplete' USING ERRCODE = '23514';
  END IF;
  SELECT count(*), min(ordinal), max(ordinal) INTO tag_count, first_tag, last_tag FROM public.track_tags WHERE track_id = target;
  IF tag_count NOT BETWEEN 0 AND 10 OR (tag_count > 0 AND (first_tag <> 0 OR last_tag <> tag_count - 1)) THEN
    RAISE EXCEPTION 'Track tags are incomplete' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.track_upload_attempts WHERE track_id = target AND owner_id = t.owner_id AND request_id = t.request_id AND file_id = t.original_file_id AND state = 'complete') THEN
    RAISE EXCEPTION 'Track publication result is incomplete' USING ERRCODE = '23514';
  END IF;
END; $$;

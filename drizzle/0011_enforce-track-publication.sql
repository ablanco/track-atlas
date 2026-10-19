ALTER TABLE "track_data" ADD CONSTRAINT "track_data_coordinates_check" CHECK (ST_XMin("track_data"."geometry"::box3d) >= -180 AND ST_XMax("track_data"."geometry"::box3d) <= 180 AND ST_YMin("track_data"."geometry"::box3d) >= -90 AND ST_YMax("track_data"."geometry"::box3d) <= 90);--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_elevation_coverage_check" CHECK ((("tracks"."elevation_sample_count" = 0) = ("tracks"."min_elevation_meters" IS NULL AND "tracks"."max_elevation_meters" IS NULL)) AND ("tracks"."elevation_sample_count" = 0 OR ("tracks"."min_elevation_meters" IS NOT NULL AND "tracks"."max_elevation_meters" IS NOT NULL AND "tracks"."min_elevation_meters" <= "tracks"."max_elevation_meters")) AND (("tracks"."elevation_sample_count" = "tracks"."point_count") = ("tracks"."ascent_meters" IS NOT NULL AND "tracks"."descent_meters" IS NOT NULL)) AND (("tracks"."ascent_meters" IS NULL) = ("tracks"."descent_meters" IS NULL)));
--> statement-breakpoint
-- Derived records and the original become usable only as one complete unit.
CREATE FUNCTION public.assert_complete_track(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t public.tracks%ROWTYPE; f public.stored_files%ROWTYPE; tag_count integer; first_tag integer; last_tag integer;
BEGIN
  SELECT * INTO t FROM public.tracks WHERE id = target;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO f FROM public.stored_files WHERE id = t.original_file_id FOR UPDATE;
  IF NOT FOUND OR f.owner_id <> t.owner_id OR f.purpose <> 'gpx' OR f.status <> 'ready' THEN
    RAISE EXCEPTION 'Track original must be an owned ready GPX' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.track_data WHERE track_id = target AND ST_NPoints(geometry) = t.point_count) OR
     (SELECT count(*) FROM public.track_directional_representations WHERE track_id = target AND version = t.version) <> 5 THEN
    RAISE EXCEPTION 'Track derived records are incomplete' USING ERRCODE = '23514';
  END IF;
  SELECT count(*), min(ordinal), max(ordinal) INTO tag_count, first_tag, last_tag FROM public.track_tags WHERE track_id = target;
  IF tag_count NOT BETWEEN 1 AND 10 OR first_tag <> 0 OR last_tag <> tag_count - 1 THEN
    RAISE EXCEPTION 'Track tags are incomplete' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.track_upload_attempts WHERE track_id = target AND owner_id = t.owner_id AND request_id = t.request_id AND file_id = t.original_file_id AND state = 'complete') THEN
    RAISE EXCEPTION 'Track publication result is incomplete' USING ERRCODE = '23514';
  END IF;
END; $$;
--> statement-breakpoint
CREATE FUNCTION public.enforce_complete_track() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'tracks' THEN
    IF TG_OP <> 'DELETE' THEN PERFORM public.assert_complete_track(NEW.id); END IF;
    IF TG_OP <> 'INSERT' THEN PERFORM public.assert_complete_track(OLD.id); END IF;
  ELSE
    IF TG_OP <> 'DELETE' THEN PERFORM public.assert_complete_track(NEW.track_id); END IF;
    IF TG_OP <> 'INSERT' THEN PERFORM public.assert_complete_track(OLD.track_id); END IF;
  END IF;
  RETURN NULL;
END; $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tracks_complete AFTER INSERT OR UPDATE ON public.tracks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_track();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER track_data_complete AFTER INSERT OR UPDATE OR DELETE ON public.track_data DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_track();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER track_tags_complete AFTER INSERT OR UPDATE OR DELETE ON public.track_tags DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_track();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER track_variants_complete AFTER INSERT OR UPDATE OR DELETE ON public.track_directional_representations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_track();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER track_attempt_complete AFTER INSERT OR UPDATE OR DELETE ON public.track_upload_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_track();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_attached_track_file_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.owner_id, NEW.purpose, NEW.status, NEW.object_key, NEW.storage_location, NEW.byte_size, NEW.sha256, NEW.content_type) IS DISTINCT FROM
     ROW(OLD.owner_id, OLD.purpose, OLD.status, OLD.object_key, OLD.storage_location, OLD.byte_size, OLD.sha256, OLD.content_type) AND
     EXISTS (SELECT 1 FROM public.tracks WHERE original_file_id = OLD.id) THEN
    RAISE EXCEPTION 'Attached track original is immutable' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
DROP TRIGGER stored_files_reject_attached_track_delete ON public.stored_files;
--> statement-breakpoint
CREATE TRIGGER stored_files_reject_attached_track_delete BEFORE UPDATE ON public.stored_files FOR EACH ROW EXECUTE FUNCTION public.reject_attached_track_file_deletion();
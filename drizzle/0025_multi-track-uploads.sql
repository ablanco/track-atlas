ALTER TABLE "track_upload_attempts" DROP CONSTRAINT "track_attempt_state_check";--> statement-breakpoint
ALTER TABLE "track_upload_attempts" DROP CONSTRAINT "track_upload_attempts_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "track_upload_attempts" DROP CONSTRAINT "track_upload_attempts_file_id_stored_files_id_fk";
--> statement-breakpoint
ALTER TABLE "track_upload_attempts" DROP CONSTRAINT "track_upload_attempts_track_id_tracks_id_fk";
--> statement-breakpoint
DROP INDEX "tracks_request_unique";--> statement-breakpoint
ALTER TABLE "deleted_track_uploads" DROP CONSTRAINT "deleted_track_uploads_owner_id_request_id_pk";--> statement-breakpoint
ALTER TABLE "track_upload_attempts" ALTER COLUMN "file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deleted_track_uploads" ADD CONSTRAINT "deleted_track_uploads_owner_id_request_id_track_id_pk" PRIMARY KEY("owner_id","request_id","track_id");--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "upload_group_id" uuid;--> statement-breakpoint
ALTER TABLE "track_upload_attempts" ADD COLUMN "track_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "upload_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "track_upload_attempts" ADD CONSTRAINT "track_upload_attempts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_upload_attempts" ADD CONSTRAINT "track_upload_attempts_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_upload_attempts" ADD CONSTRAINT "track_upload_attempts_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_request_unique" ON "tracks" USING btree ("owner_id","request_id","upload_index");--> statement-breakpoint
-- Preserve every pre-existing singleton receipt and pending file admission.
UPDATE public.track_upload_attempts SET track_ids = ARRAY[track_id] WHERE state = 'complete';
--> statement-breakpoint
UPDATE public.stored_files f SET upload_group_id = a.file_id FROM public.track_upload_attempts a WHERE f.id = a.file_id;
--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;
--> statement-breakpoint
ALTER TABLE "track_upload_attempts" ADD CONSTRAINT "track_attempt_state_check" CHECK ("track_upload_attempts"."fingerprint" ~ '^[a-f0-9]{64}$' AND "track_upload_attempts"."state" IN ('pending','complete','failed','deleted') AND (("track_upload_attempts"."state" = 'complete') = ("track_upload_attempts"."track_id" IS NOT NULL)) AND (("track_upload_attempts"."state" IN ('complete','deleted') AND cardinality("track_upload_attempts"."track_ids") BETWEEN 1 AND 100) OR ("track_upload_attempts"."state" IN ('pending','failed') AND cardinality("track_upload_attempts"."track_ids") = 0)));--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_upload_index_check" CHECK ("tracks"."upload_index" BETWEEN 0 AND 99);
--> statement-breakpoint
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
  IF NOT EXISTS (SELECT 1 FROM public.track_upload_attempts WHERE owner_id = t.owner_id AND request_id = t.request_id AND track_ids[t.upload_index + 1] = target AND state IN ('complete','deleted')) THEN
    RAISE EXCEPTION 'Track publication result is incomplete' USING ERRCODE = '23514';
  END IF;
END; $$;

--> statement-breakpoint
-- Enforce the whole receipt as well as individual derived datasets. Completed
-- outputs are contiguous, unique, and bound to the same owner/request. Deleted
-- receipts retain just identities, permitting independent surviving edits.
CREATE FUNCTION public.assert_track_upload(owner uuid, request uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a public.track_upload_attempts%ROWTYPE; output uuid; position integer := 0;
BEGIN
  SELECT * INTO a FROM public.track_upload_attempts WHERE owner_id=owner AND request_id=request;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.tracks WHERE owner_id=owner AND request_id=request) THEN
      RAISE EXCEPTION 'Missing upload receipt' USING ERRCODE='23514';
    END IF;
    RETURN;
  END IF;
  IF a.state IN ('complete','deleted') THEN
    IF array_ndims(a.track_ids) <> 1 OR array_lower(a.track_ids,1) <> 1 OR
       (SELECT count(DISTINCT id) FROM unnest(a.track_ids) id) <> cardinality(a.track_ids) THEN
      RAISE EXCEPTION 'Invalid ordered upload identities' USING ERRCODE='23514';
    END IF;
    FOREACH output IN ARRAY a.track_ids LOOP
      IF EXISTS (SELECT 1 FROM public.tracks WHERE id=output AND owner_id=owner AND request_id=request AND upload_index=position) THEN
        PERFORM public.assert_complete_track(output);
      ELSIF a.state <> 'deleted' OR NOT EXISTS (SELECT 1 FROM public.deleted_track_uploads WHERE owner_id=owner AND request_id=request AND track_id=output) THEN
        RAISE EXCEPTION 'Upload outputs are incomplete' USING ERRCODE='23514';
      END IF;
      position := position + 1;
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.tracks WHERE owner_id=owner AND request_id=request AND (upload_index >= cardinality(a.track_ids) OR id <> a.track_ids[upload_index+1])) THEN
      RAISE EXCEPTION 'Unexpected upload output' USING ERRCODE='23514';
    END IF;
    IF a.state = 'complete' AND NOT EXISTS (SELECT 1 FROM public.tracks WHERE id=a.track_id AND id=a.track_ids[1] AND original_file_id=a.file_id) THEN
      RAISE EXCEPTION 'Invalid first upload output' USING ERRCODE='23514';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.tracks WHERE owner_id=owner AND request_id=request) THEN
    RAISE EXCEPTION 'Unpublished upload has Tracks' USING ERRCODE='23514';
  END IF;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_complete_track() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'track_upload_attempts' THEN
    IF TG_OP <> 'DELETE' THEN PERFORM public.assert_track_upload(NEW.owner_id,NEW.request_id); END IF;
    IF TG_OP <> 'INSERT' THEN PERFORM public.assert_track_upload(OLD.owner_id,OLD.request_id); END IF;
  ELSIF TG_TABLE_NAME = 'tracks' THEN
    IF TG_OP <> 'DELETE' THEN PERFORM public.assert_complete_track(NEW.id); END IF;
    IF TG_OP <> 'INSERT' THEN PERFORM public.assert_complete_track(OLD.id); END IF;
  ELSE
    IF TG_OP <> 'DELETE' THEN PERFORM public.assert_complete_track(NEW.track_id); END IF;
    IF TG_OP <> 'INSERT' THEN PERFORM public.assert_complete_track(OLD.track_id); END IF;
  END IF;
  RETURN NULL;
END; $$;

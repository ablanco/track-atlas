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
  IF NOT EXISTS (SELECT 1 FROM public.track_data WHERE track_id = target AND ST_NPoints(geometry) = t.point_count) OR
     (SELECT count(*) FROM public.track_directional_representations WHERE track_id = target AND version = t.version) <> 5 THEN
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

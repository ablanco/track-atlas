-- First-output FKs already guard its deletion. Cover every later output as
-- well, so a complete receipt can never acknowledge an accidentally lost ID.
CREATE FUNCTION public.enforce_track_output_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.track_upload_attempts WHERE owner_id=OLD.owner_id AND request_id=OLD.request_id) THEN
    PERFORM public.assert_track_upload(OLD.owner_id, OLD.request_id);
  END IF;
  RETURN NULL;
END; $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER track_output_deletion AFTER DELETE ON public.tracks
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_track_output_deletion();

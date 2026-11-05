-- The former singleton receipt bound a Track directly to its file. Ordered
-- receipts must retain the same immutable association for every output.
CREATE FUNCTION public.reject_track_identity_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.owner_id,NEW.request_id,NEW.upload_index,NEW.original_file_id)
     IS DISTINCT FROM ROW(OLD.id,OLD.owner_id,OLD.request_id,OLD.upload_index,OLD.original_file_id) THEN
    RAISE EXCEPTION 'Track identity and original are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER tracks_reject_identity_change BEFORE UPDATE ON public.tracks
FOR EACH ROW EXECUTE FUNCTION public.reject_track_identity_change();

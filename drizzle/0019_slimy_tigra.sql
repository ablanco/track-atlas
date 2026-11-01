CREATE TABLE "track_votes" (
	"track_id" uuid NOT NULL,
	"voter_id" uuid NOT NULL,
	"direction" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_votes_track_id_voter_id_pk" PRIMARY KEY("track_id","voter_id"),
	CONSTRAINT "track_votes_direction_check" CHECK ("track_votes"."direction" IN (-1, 1))
);
--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "popularity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "track_votes" ADD CONSTRAINT "track_votes_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_votes" ADD CONSTRAINT "track_votes_voter_id_users_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "track_votes_voter_index" ON "track_votes" USING btree ("voter_id");--> statement-breakpoint
CREATE TRIGGER track_votes_set_updated_at BEFORE UPDATE ON public.track_votes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE FUNCTION public.update_track_popularity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.tracks SET popularity = popularity + NEW.direction WHERE id = NEW.track_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.tracks SET popularity = popularity - OLD.direction WHERE id = OLD.track_id;
  ELSE
    UPDATE public.tracks SET popularity = popularity - OLD.direction WHERE id = OLD.track_id;
    UPDATE public.tracks SET popularity = popularity + NEW.direction WHERE id = NEW.track_id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER track_votes_popularity AFTER INSERT OR UPDATE OR DELETE ON public.track_votes
FOR EACH ROW EXECUTE FUNCTION public.update_track_popularity();

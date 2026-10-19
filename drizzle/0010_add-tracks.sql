CREATE TABLE "track_data" (
	"track_id" uuid PRIMARY KEY NOT NULL,
	"geometry" geometry(LineString,4326) NOT NULL,
	"samples" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_data_samples_check" CHECK (jsonb_typeof("track_data"."samples") = 'array' AND jsonb_array_length("track_data"."samples") = ST_NPoints("track_data"."geometry") AND ST_NPoints("track_data"."geometry") BETWEEN 2 AND 100000 AND NOT ST_IsEmpty("track_data"."geometry"))
);
--> statement-breakpoint
CREATE TABLE "track_directional_representations" (
	"track_id" uuid NOT NULL,
	"intermediate_count" integer NOT NULL,
	"geometry" geometry(LineString,4326) NOT NULL,
	"directionless_edges" jsonb NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_directional_representations_track_id_intermediate_count_pk" PRIMARY KEY("track_id","intermediate_count"),
	CONSTRAINT "track_representations_values_check" CHECK ("track_directional_representations"."intermediate_count" IN (0,1,3,4,5) AND "track_directional_representations"."version" = 1 AND ST_NPoints("track_directional_representations"."geometry") = "track_directional_representations"."intermediate_count" + 2 AND jsonb_typeof("track_directional_representations"."directionless_edges") = 'array' AND jsonb_array_length("track_directional_representations"."directionless_edges") = "track_directional_representations"."intermediate_count" + 1)
);
--> statement-breakpoint
CREATE TABLE "track_tags" (
	"track_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"label" text NOT NULL,
	"normalized_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_tags_track_id_ordinal_pk" PRIMARY KEY("track_id","ordinal"),
	CONSTRAINT "track_tags_values_check" CHECK ("track_tags"."ordinal" BETWEEN 0 AND 9 AND char_length("track_tags"."label") BETWEEN 1 AND 30 AND btrim("track_tags"."label") <> '' AND char_length("track_tags"."normalized_key") BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE TABLE "track_upload_attempts" (
	"owner_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"file_id" uuid NOT NULL,
	"track_id" uuid,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_upload_attempts_owner_id_request_id_pk" PRIMARY KEY("owner_id","request_id"),
	CONSTRAINT "track_attempt_state_check" CHECK ("track_upload_attempts"."fingerprint" ~ '^[a-f0-9]{64}$' AND "track_upload_attempts"."state" IN ('pending','complete','failed') AND (("track_upload_attempts"."state" = 'complete') = ("track_upload_attempts"."track_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"original_file_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"activity" text NOT NULL,
	"difficulty" integer NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"point_count" integer NOT NULL,
	"distance_meters" double precision NOT NULL,
	"duration_seconds" double precision,
	"ascent_meters" double precision,
	"descent_meters" double precision,
	"min_elevation_meters" double precision,
	"max_elevation_meters" double precision,
	"elevation_sample_count" integer NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracks_text_check" CHECK (char_length("tracks"."name") BETWEEN 1 AND 200 AND btrim("tracks"."name") <> '' AND char_length("tracks"."description") BETWEEN 1 AND 5000 AND btrim("tracks"."description") <> ''),
	CONSTRAINT "tracks_activity_check" CHECK ("tracks"."activity" IN ('walking', 'hiking', 'road_running', 'trail_running', 'cycling', 'mountain_biking', 'ski_touring', 'cross_country_skiing', 'snowshoeing', 'paddling', 'horse_riding', 'four_by_four', 'road_motorcycling', 'off_road_motorcycling', 'atv_quad', 'other')),
	CONSTRAINT "tracks_classification_check" CHECK ("tracks"."difficulty" BETWEEN 1 AND 5 AND "tracks"."visibility" = 'private' AND "tracks"."version" = 1),
	CONSTRAINT "tracks_metrics_check" CHECK ("tracks"."point_count" BETWEEN 2 AND 100000 AND "tracks"."distance_meters" > 0 AND "tracks"."distance_meters" < 'Infinity'::float8 AND "tracks"."elevation_sample_count" BETWEEN 0 AND "tracks"."point_count" AND ("tracks"."duration_seconds" IS NULL OR ("tracks"."duration_seconds" > 0 AND "tracks"."duration_seconds" < 'Infinity'::float8)) AND ("tracks"."ascent_meters" IS NULL OR ("tracks"."ascent_meters" >= 0 AND "tracks"."ascent_meters" < 'Infinity'::float8)) AND ("tracks"."descent_meters" IS NULL OR ("tracks"."descent_meters" >= 0 AND "tracks"."descent_meters" < 'Infinity'::float8)) AND ("tracks"."min_elevation_meters" IS NULL OR ("tracks"."min_elevation_meters" > '-Infinity'::float8 AND "tracks"."min_elevation_meters" < 'Infinity'::float8)) AND ("tracks"."max_elevation_meters" IS NULL OR ("tracks"."max_elevation_meters" > '-Infinity'::float8 AND "tracks"."max_elevation_meters" < 'Infinity'::float8)))
);
--> statement-breakpoint
ALTER TABLE "track_data" ADD CONSTRAINT "track_data_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_directional_representations" ADD CONSTRAINT "track_directional_representations_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_tags" ADD CONSTRAINT "track_tags_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_upload_attempts" ADD CONSTRAINT "track_upload_attempts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_upload_attempts" ADD CONSTRAINT "track_upload_attempts_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_upload_attempts" ADD CONSTRAINT "track_upload_attempts_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_original_file_id_stored_files_id_fk" FOREIGN KEY ("original_file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "track_data_geometry_index" ON "track_data" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "track_representations_geometry_index" ON "track_directional_representations" USING gist ("geometry");--> statement-breakpoint
CREATE UNIQUE INDEX "track_tags_key_unique" ON "track_tags" USING btree ("track_id","normalized_key");--> statement-breakpoint
CREATE INDEX "track_tags_key_index" ON "track_tags" USING btree ("normalized_key");--> statement-breakpoint
CREATE UNIQUE INDEX "track_attempt_file_unique" ON "track_upload_attempts" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_original_unique" ON "tracks" USING btree ("original_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_request_unique" ON "tracks" USING btree ("owner_id","request_id");--> statement-breakpoint
CREATE INDEX "tracks_owner_created_index" ON "tracks" USING btree ("owner_id","created_at");
--> statement-breakpoint
CREATE TRIGGER track_data_set_updated_at BEFORE UPDATE ON "track_data" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER track_directional_representations_set_updated_at BEFORE UPDATE ON "track_directional_representations" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER track_tags_set_updated_at BEFORE UPDATE ON "track_tags" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER track_upload_attempts_set_updated_at BEFORE UPDATE ON "track_upload_attempts" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER tracks_set_updated_at BEFORE UPDATE ON "tracks" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE FUNCTION public.reject_attached_track_file_deletion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status <> 'deleting' AND NEW.status = 'deleting' AND EXISTS (SELECT 1 FROM public.tracks WHERE original_file_id = OLD.id) THEN RAISE EXCEPTION 'Stored file is attached to a track' USING ERRCODE = '23503'; END IF; RETURN NEW; END; $$;
--> statement-breakpoint
CREATE TRIGGER stored_files_reject_attached_track_delete BEFORE UPDATE OF status ON public.stored_files FOR EACH ROW EXECUTE FUNCTION public.reject_attached_track_file_deletion();
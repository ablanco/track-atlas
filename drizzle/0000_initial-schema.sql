-- First-release baseline for an empty database.
-- Extensions and the segment validator must precede generated table checks.
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
--> statement-breakpoint
CREATE FUNCTION public.valid_track_segments(path geometry, starts jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
AS $function$
DECLARE parts integer := ST_NumGeometries(path); offset_count integer := 0; part geometry;
BEGIN
  IF jsonb_typeof(starts) <> 'array' OR parts NOT BETWEEN 1 AND 100 OR jsonb_array_length(starts) <> parts THEN RETURN false; END IF;
  FOR i IN 1..parts LOOP
    part := ST_GeometryN(path,i);
    IF ST_IsEmpty(part) OR ST_NPoints(part) < 2 OR starts->(i-1) IS DISTINCT FROM to_jsonb(offset_count) THEN RETURN false; END IF;
    offset_count := offset_count + ST_NPoints(part);
  END LOOP;
  RETURN true;
END; $function$;
--> statement-breakpoint
CREATE TABLE "account_action_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_action_tokens_purpose_check" CHECK ("account_action_tokens"."purpose" IN ('email-confirmation','password-reset'))
);
--> statement-breakpoint
CREATE TABLE "captcha_uses" (
	"challenge_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deleted_track_uploads" (
	"owner_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deleted_track_uploads_owner_id_request_id_track_id_pk" PRIMARY KEY("owner_id","request_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "discussion_post_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_send_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"attempted_at" timestamp with time zone[] DEFAULT '{}'::timestamptz[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"terms_version" text NOT NULL,
	"privacy_version" text NOT NULL,
	"locale" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_acceptances_locale_check" CHECK ("legal_acceptances"."locale" IN ('en', 'es', 'fr', 'pt', 'de', 'it')),
	CONSTRAINT "legal_acceptances_terms_version_check" CHECK (btrim("legal_acceptances"."terms_version") <> ''),
	CONSTRAINT "legal_acceptances_privacy_version_check" CHECK (btrim("legal_acceptances"."privacy_version") <> '')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_location" text NOT NULL,
	"object_key" text NOT NULL,
	"upload_group_id" uuid,
	"byte_size" integer NOT NULL,
	"content_type" text,
	"sha256" text,
	"avatar_128_bytes" integer,
	"avatar_128_sha256" text,
	"avatar_24_bytes" integer,
	"avatar_24_sha256" text,
	"expires_at" timestamp with time zone DEFAULT now() + interval '15 minutes' NOT NULL,
	"delete_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_avatar_versions_check" CHECK ((
    "stored_files"."avatar_128_bytes" IS NULL AND "stored_files"."avatar_128_sha256" IS NULL AND "stored_files"."avatar_24_bytes" IS NULL AND "stored_files"."avatar_24_sha256" IS NULL
  ) OR (
    "stored_files"."purpose" = 'avatar' AND
    "stored_files"."avatar_128_bytes" IS NOT NULL AND "stored_files"."avatar_128_bytes" BETWEEN 1 AND 65536 AND
    "stored_files"."avatar_24_bytes" IS NOT NULL AND "stored_files"."avatar_24_bytes" BETWEEN 1 AND 65536 AND
    "stored_files"."avatar_128_sha256" IS NOT NULL AND "stored_files"."avatar_128_sha256" ~ '^[a-f0-9]{64}$' AND
    "stored_files"."avatar_24_sha256" IS NOT NULL AND "stored_files"."avatar_24_sha256" ~ '^[a-f0-9]{64}$'
  )),
	CONSTRAINT "stored_files_purpose_check" CHECK ("stored_files"."purpose" IN ('avatar', 'gpx', 'photo')),
	CONSTRAINT "stored_files_status_check" CHECK ("stored_files"."status" IN ('pending', 'ready', 'deleting')),
	CONSTRAINT "stored_files_size_check" CHECK ("stored_files"."byte_size" > 0 AND "stored_files"."byte_size" <= CASE WHEN "stored_files"."purpose" = 'photo' THEN 46137344 ELSE 10485760 END),
	CONSTRAINT "stored_files_object_key_check" CHECK ("stored_files"."object_key" = "stored_files"."id"::text OR ("stored_files"."purpose" = 'avatar' AND "stored_files"."object_key" = 'avatars/original/' || "stored_files"."id"::text)),
	CONSTRAINT "stored_files_location_check" CHECK ("stored_files"."storage_location" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "stored_files_ready_check" CHECK ("stored_files"."status" <> 'ready' OR ("stored_files"."content_type" IS NOT NULL AND "stored_files"."sha256" IS NOT NULL AND "stored_files"."sha256" ~ '^[a-f0-9]{64}$' AND (("stored_files"."purpose" = 'avatar' AND "stored_files"."content_type" ~ '^image/[a-z0-9][a-z0-9.+-]*$' AND "stored_files"."content_type" <> 'image/svg+xml') OR ("stored_files"."purpose" = 'gpx' AND "stored_files"."content_type" = 'application/gpx+xml') OR ("stored_files"."purpose" = 'photo' AND "stored_files"."content_type" IN ('image/jpeg','image/png','image/webp','image/avif'))))),
	CONSTRAINT "stored_files_deleting_check" CHECK (("stored_files"."status" = 'deleting') = ("stored_files"."delete_after" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "track_comment_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_comment_replies_text_check" CHECK (char_length("track_comment_replies"."text") BETWEEN 1 AND 2000 AND btrim("track_comment_replies"."text") <> '')
);
--> statement-breakpoint
CREATE TABLE "track_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_comments_text_check" CHECK (char_length("track_comments"."text") BETWEEN 1 AND 2000 AND btrim("track_comments"."text") <> '')
);
--> statement-breakpoint
CREATE TABLE "track_data" (
	"track_id" uuid PRIMARY KEY NOT NULL,
	"geometry" geometry(MultiLineString,4326) NOT NULL,
	"segment_starts" jsonb DEFAULT '[0]'::jsonb NOT NULL,
	"samples" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_data_coordinates_check" CHECK (ST_XMin("track_data"."geometry"::box3d) >= -180 AND ST_XMax("track_data"."geometry"::box3d) <= 180 AND ST_YMin("track_data"."geometry"::box3d) >= -90 AND ST_YMax("track_data"."geometry"::box3d) <= 90),
	CONSTRAINT "track_data_samples_check" CHECK (jsonb_typeof("track_data"."samples") = 'array' AND jsonb_array_length("track_data"."samples") = ST_NPoints("track_data"."geometry") AND ST_NPoints("track_data"."geometry") BETWEEN 2 AND 100000 AND NOT ST_IsEmpty("track_data"."geometry") AND public.valid_track_segments("track_data"."geometry", "track_data"."segment_starts"))
);
--> statement-breakpoint
CREATE TABLE "track_list_memberships" (
	"list_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_list_memberships_list_id_track_id_pk" PRIMARY KEY("list_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "track_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_lists_name_valid" CHECK (char_length("track_lists"."name") BETWEEN 1 AND 100 AND "track_lists"."name"=btrim("track_lists"."name"))
);
--> statement-breakpoint
CREATE TABLE "track_photo_versions" (
	"photo_id" uuid NOT NULL,
	"size" text NOT NULL,
	"format" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_photo_versions_photo_id_size_format_pk" PRIMARY KEY("photo_id","size","format"),
	CONSTRAINT "track_photo_versions_shape_check" CHECK ("track_photo_versions"."size" IN ('large','thumbnail') AND "track_photo_versions"."format" IN ('jpeg','webp','avif') AND "track_photo_versions"."byte_size" BETWEEN 1 AND 4194304 AND "track_photo_versions"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "track_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"track_id" uuid,
	"caption" text DEFAULT '' NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_photos_caption_check" CHECK (char_length("track_photos"."caption") <= 500)
);
--> statement-breakpoint
CREATE TABLE "track_directional_representations" (
	"track_id" uuid NOT NULL,
	"segment_index" integer DEFAULT 0 NOT NULL,
	"intermediate_count" integer NOT NULL,
	"geometry" geometry(LineString,4326) NOT NULL,
	"directionless_edges" jsonb NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_directional_representations_track_id_segment_index_intermediate_count_pk" PRIMARY KEY("track_id","segment_index","intermediate_count"),
	CONSTRAINT "track_representations_values_check" CHECK ("track_directional_representations"."segment_index" BETWEEN 0 AND 99 AND "track_directional_representations"."intermediate_count" IN (0,1,3,4,5) AND "track_directional_representations"."version" IN (1,2) AND ST_NPoints("track_directional_representations"."geometry") = "track_directional_representations"."intermediate_count" + 2 AND jsonb_typeof("track_directional_representations"."directionless_edges") = 'array' AND jsonb_array_length("track_directional_representations"."directionless_edges") = "track_directional_representations"."intermediate_count" + 1)
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
	"file_id" uuid,
	"track_id" uuid,
	"state" text NOT NULL,
	"track_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_upload_attempts_owner_id_request_id_pk" PRIMARY KEY("owner_id","request_id"),
	CONSTRAINT "track_attempt_state_check" CHECK ("track_upload_attempts"."fingerprint" ~ '^[a-f0-9]{64}$' AND "track_upload_attempts"."state" IN ('pending','complete','failed','deleted') AND (("track_upload_attempts"."state" = 'complete') = ("track_upload_attempts"."track_id" IS NOT NULL)) AND (("track_upload_attempts"."state" IN ('complete','deleted') AND cardinality("track_upload_attempts"."track_ids") BETWEEN 1 AND 100) OR ("track_upload_attempts"."state" IN ('pending','failed') AND cardinality("track_upload_attempts"."track_ids") = 0)))
);
--> statement-breakpoint
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
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"original_file_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"upload_index" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"activity" text NOT NULL,
	"difficulty" integer NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"point_count" integer NOT NULL,
	"segment_count" integer DEFAULT 1 NOT NULL,
	"distance_meters" double precision NOT NULL,
	"duration_seconds" double precision,
	"ascent_meters" double precision,
	"descent_meters" double precision,
	"min_elevation_meters" double precision,
	"max_elevation_meters" double precision,
	"elevation_sample_count" integer NOT NULL,
	"popularity" integer DEFAULT 0 NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracks_upload_index_check" CHECK ("tracks"."upload_index" BETWEEN 0 AND 99),
	CONSTRAINT "tracks_text_check" CHECK (char_length("tracks"."name") BETWEEN 1 AND 200 AND btrim("tracks"."name") <> '' AND char_length("tracks"."description") BETWEEN 1 AND 5000 AND btrim("tracks"."description") <> ''),
	CONSTRAINT "tracks_activity_check" CHECK ("tracks"."activity" IN ('walking', 'hiking', 'road_running', 'trail_running', 'cycling', 'mountain_biking', 'ski_touring', 'cross_country_skiing', 'snowshoeing', 'paddling', 'horse_riding', 'four_by_four', 'road_motorcycling', 'off_road_motorcycling', 'atv_quad', 'other')),
	CONSTRAINT "tracks_classification_check" CHECK ("tracks"."difficulty" BETWEEN 1 AND 5 AND "tracks"."visibility" IN ('private', 'public') AND "tracks"."version" IN (1,2)),
	CONSTRAINT "tracks_elevation_coverage_check" CHECK ((("tracks"."elevation_sample_count" = 0) = ("tracks"."min_elevation_meters" IS NULL AND "tracks"."max_elevation_meters" IS NULL)) AND ("tracks"."elevation_sample_count" = 0 OR ("tracks"."min_elevation_meters" IS NOT NULL AND "tracks"."max_elevation_meters" IS NOT NULL AND "tracks"."min_elevation_meters" <= "tracks"."max_elevation_meters")) AND (("tracks"."elevation_sample_count" = "tracks"."point_count") = ("tracks"."ascent_meters" IS NOT NULL AND "tracks"."descent_meters" IS NOT NULL)) AND (("tracks"."ascent_meters" IS NULL) = ("tracks"."descent_meters" IS NULL))),
	CONSTRAINT "tracks_metrics_check" CHECK ("tracks"."segment_count" BETWEEN 1 AND 100 AND ("tracks"."version" <> 1 OR "tracks"."segment_count" = 1) AND "tracks"."point_count" BETWEEN 2 * "tracks"."segment_count" AND 100000 AND "tracks"."distance_meters" > 0 AND "tracks"."distance_meters" < 'Infinity'::float8 AND "tracks"."elevation_sample_count" BETWEEN 0 AND "tracks"."point_count" AND ("tracks"."duration_seconds" IS NULL OR ("tracks"."duration_seconds" > 0 AND "tracks"."duration_seconds" < 'Infinity'::float8)) AND ("tracks"."ascent_meters" IS NULL OR ("tracks"."ascent_meters" >= 0 AND "tracks"."ascent_meters" < 'Infinity'::float8)) AND ("tracks"."descent_meters" IS NULL OR ("tracks"."descent_meters" >= 0 AND "tracks"."descent_meters" < 'Infinity'::float8)) AND ("tracks"."min_elevation_meters" IS NULL OR ("tracks"."min_elevation_meters" > '-Infinity'::float8 AND "tracks"."min_elevation_meters" < 'Infinity'::float8)) AND ("tracks"."max_elevation_meters" IS NULL OR ("tracks"."max_elevation_meters" > '-Infinity'::float8 AND "tracks"."max_elevation_meters" < 'Infinity'::float8)))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"display_name" text,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"avatar_url" text,
	"avatar_file_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"erasure_started_at" timestamp with time zone,
	"admin" boolean DEFAULT false NOT NULL,
	"email_confirmed" boolean DEFAULT false NOT NULL,
	"discussion_emails_enabled" boolean DEFAULT true NOT NULL,
	"discussion_email_locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_erasure_inactive" CHECK ("users"."erasure_started_at" IS NULL OR NOT "users"."active"),
	CONSTRAINT "users_discussion_email_locale_check" CHECK ("users"."discussion_email_locale" IN ('en', 'es', 'fr', 'pt', 'de', 'it')),
	CONSTRAINT "users_first_name_nonblank" CHECK (btrim("users"."first_name") <> ''),
	CONSTRAINT "users_last_name_nonblank" CHECK (btrim("users"."last_name") <> ''),
	CONSTRAINT "users_email_nonblank" CHECK (btrim("users"."email") <> ''),
	CONSTRAINT "users_email_trimmed" CHECK ("users"."email" = btrim("users"."email")),
	CONSTRAINT "users_password_hash_nonblank" CHECK (btrim("users"."password_hash") <> '')
);
--> statement-breakpoint
ALTER TABLE "account_action_tokens" ADD CONSTRAINT "account_action_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deleted_track_uploads" ADD CONSTRAINT "deleted_track_uploads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_post_events" ADD CONSTRAINT "discussion_post_events_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_comment_replies" ADD CONSTRAINT "track_comment_replies_comment_id_track_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."track_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_comment_replies" ADD CONSTRAINT "track_comment_replies_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_comments" ADD CONSTRAINT "track_comments_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_comments" ADD CONSTRAINT "track_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_data" ADD CONSTRAINT "track_data_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_list_memberships" ADD CONSTRAINT "track_list_memberships_list_id_track_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."track_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_list_memberships" ADD CONSTRAINT "track_list_memberships_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_lists" ADD CONSTRAINT "track_lists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_photo_versions" ADD CONSTRAINT "track_photo_versions_photo_id_track_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."track_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_photos" ADD CONSTRAINT "track_photos_id_stored_files_id_fk" FOREIGN KEY ("id") REFERENCES "public"."stored_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_photos" ADD CONSTRAINT "track_photos_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_directional_representations" ADD CONSTRAINT "track_directional_representations_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_tags" ADD CONSTRAINT "track_tags_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_upload_attempts" ADD CONSTRAINT "track_upload_attempts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_upload_attempts" ADD CONSTRAINT "track_upload_attempts_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_upload_attempts" ADD CONSTRAINT "track_upload_attempts_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_votes" ADD CONSTRAINT "track_votes_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_votes" ADD CONSTRAINT "track_votes_voter_id_users_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_original_file_id_stored_files_id_fk" FOREIGN KEY ("original_file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_file_id_stored_files_id_fk" FOREIGN KEY ("avatar_file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_action_tokens_hash_unique" ON "account_action_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "account_action_tokens_user_purpose_index" ON "account_action_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "account_action_tokens_expiry_index" ON "account_action_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "captcha_uses_expires_at_index" ON "captcha_uses" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deleted_track_uploads_track_unique" ON "deleted_track_uploads" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "discussion_post_events_author_time_index" ON "discussion_post_events" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "legal_acceptances_user_index" ON "legal_acceptances" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stored_files_owner_index" ON "stored_files" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "stored_files_cleanup_index" ON "stored_files" USING btree ("storage_location","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "track_comment_replies_comment_unique" ON "track_comment_replies" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "track_comment_replies_author_index" ON "track_comment_replies" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "track_comments_page_index" ON "track_comments" USING btree ("track_id","created_at","id");--> statement-breakpoint
CREATE INDEX "track_comments_author_index" ON "track_comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "track_data_geometry_index" ON "track_data" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "track_list_memberships_track_index" ON "track_list_memberships" USING btree ("track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "track_lists_owner_name_unique" ON "track_lists" USING btree ("owner_id","normalized_name");--> statement-breakpoint
CREATE INDEX "track_photos_track_index" ON "track_photos" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "track_representations_geometry_index" ON "track_directional_representations" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "track_representations_geography_index" ON "track_directional_representations" USING gist (("geometry"::geography)) WHERE "track_directional_representations"."intermediate_count" = 5;--> statement-breakpoint
CREATE UNIQUE INDEX "track_tags_key_unique" ON "track_tags" USING btree ("track_id","normalized_key");--> statement-breakpoint
CREATE INDEX "track_tags_key_index" ON "track_tags" USING btree ("normalized_key");--> statement-breakpoint
CREATE UNIQUE INDEX "track_attempt_file_unique" ON "track_upload_attempts" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "track_votes_voter_index" ON "track_votes" USING btree ("voter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_original_unique" ON "tracks" USING btree ("original_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_request_unique" ON "tracks" USING btree ("owner_id","request_id","upload_index");--> statement-breakpoint
CREATE INDEX "tracks_owner_created_index" ON "tracks" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));
--> statement-breakpoint
-- Custom database functions and triggers are maintained alongside the schema.
CREATE FUNCTION public.assert_complete_track(target uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
END; $function$;
--> statement-breakpoint
CREATE FUNCTION public.assert_track_upload(owner uuid, request uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
END; $function$;
--> statement-breakpoint
CREATE FUNCTION public.enforce_complete_track()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END; $function$;
--> statement-breakpoint
CREATE FUNCTION public.enforce_track_output_deletion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.track_upload_attempts WHERE owner_id=OLD.owner_id AND request_id=OLD.request_id) THEN
    PERFORM public.assert_track_upload(OLD.owner_id, OLD.request_id);
  END IF;
  RETURN NULL;
END; $function$;
--> statement-breakpoint
CREATE FUNCTION public.guard_account_erasure()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.erasure_started_at IS NOT NULL AND
     (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'Account erasure is irreversible' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.guard_erasing_account_token()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE erasing boolean;
BEGIN
  SELECT erasure_started_at IS NOT NULL INTO erasing
    FROM public.users WHERE id=NEW.user_id FOR SHARE;
  IF erasing THEN
    RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.reject_attached_track_file_deletion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF ROW(NEW.owner_id, NEW.purpose, NEW.status, NEW.object_key, NEW.storage_location, NEW.byte_size, NEW.sha256, NEW.content_type) IS DISTINCT FROM
     ROW(OLD.owner_id, OLD.purpose, OLD.status, OLD.object_key, OLD.storage_location, OLD.byte_size, OLD.sha256, OLD.content_type) AND
     EXISTS (SELECT 1 FROM public.tracks WHERE original_file_id = OLD.id) THEN
    RAISE EXCEPTION 'Attached track original is immutable' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END; $function$;
--> statement-breakpoint
CREATE FUNCTION public.reject_legal_acceptance_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Legal acceptance evidence is immutable' USING ERRCODE = '23514';
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.reject_track_identity_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF ROW(NEW.id,NEW.owner_id,NEW.request_id,NEW.upload_index,NEW.original_file_id)
     IS DISTINCT FROM ROW(OLD.id,OLD.owner_id,OLD.request_id,OLD.upload_index,OLD.original_file_id) THEN
    RAISE EXCEPTION 'Track identity and original are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $function$;
--> statement-breakpoint
CREATE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.update_track_popularity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;
--> statement-breakpoint
CREATE TRIGGER account_action_tokens_set_updated_at BEFORE UPDATE ON public.account_action_tokens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER account_tokens_guard_erasure BEFORE INSERT ON public.account_action_tokens FOR EACH ROW EXECUTE FUNCTION public.guard_erasing_account_token();
--> statement-breakpoint
CREATE TRIGGER captcha_uses_set_updated_at BEFORE UPDATE ON public.captcha_uses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER deleted_track_uploads_updated_at BEFORE UPDATE ON public.deleted_track_uploads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER discussion_post_events_set_updated_at BEFORE UPDATE ON public.discussion_post_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER email_send_limits_set_updated_at BEFORE UPDATE ON public.email_send_limits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER legal_acceptances_immutable BEFORE UPDATE ON public.legal_acceptances FOR EACH ROW EXECUTE FUNCTION public.reject_legal_acceptance_update();
--> statement-breakpoint
CREATE TRIGGER legal_acceptances_set_updated_at BEFORE UPDATE ON public.legal_acceptances FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER sessions_guard_erasure BEFORE INSERT OR UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.guard_erasing_account_token();
--> statement-breakpoint
CREATE TRIGGER sessions_set_updated_at BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER stored_files_reject_attached_track_delete BEFORE UPDATE ON public.stored_files FOR EACH ROW EXECUTE FUNCTION public.reject_attached_track_file_deletion();
--> statement-breakpoint
CREATE TRIGGER stored_files_set_updated_at BEFORE UPDATE ON public.stored_files FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER track_comment_replies_set_updated_at BEFORE UPDATE ON public.track_comment_replies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER track_comments_set_updated_at BEFORE UPDATE ON public.track_comments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER track_data_complete AFTER INSERT OR DELETE OR UPDATE ON public.track_data DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_track();
--> statement-breakpoint
CREATE TRIGGER track_data_set_updated_at BEFORE UPDATE ON public.track_data FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER track_directional_representations_set_updated_at BEFORE UPDATE ON public.track_directional_representations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER track_variants_complete AFTER INSERT OR DELETE OR UPDATE ON public.track_directional_representations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_track();
--> statement-breakpoint
CREATE TRIGGER track_list_memberships_set_updated_at BEFORE UPDATE ON public.track_list_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER track_lists_set_updated_at BEFORE UPDATE ON public.track_lists FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER track_photo_versions_set_updated_at BEFORE UPDATE ON public.track_photo_versions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER track_photos_set_updated_at BEFORE UPDATE ON public.track_photos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER track_tags_complete AFTER INSERT OR DELETE OR UPDATE ON public.track_tags DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_track();
--> statement-breakpoint
CREATE TRIGGER track_tags_set_updated_at BEFORE UPDATE ON public.track_tags FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER track_attempt_complete AFTER INSERT OR DELETE OR UPDATE ON public.track_upload_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_track();
--> statement-breakpoint
CREATE TRIGGER track_upload_attempts_set_updated_at BEFORE UPDATE ON public.track_upload_attempts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER track_votes_popularity AFTER INSERT OR DELETE OR UPDATE ON public.track_votes FOR EACH ROW EXECUTE FUNCTION public.update_track_popularity();
--> statement-breakpoint
CREATE TRIGGER track_votes_set_updated_at BEFORE UPDATE ON public.track_votes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER track_output_deletion AFTER DELETE ON public.tracks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_track_output_deletion();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tracks_complete AFTER INSERT OR UPDATE ON public.tracks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_track();
--> statement-breakpoint
CREATE TRIGGER tracks_reject_identity_change BEFORE UPDATE ON public.tracks FOR EACH ROW EXECUTE FUNCTION public.reject_track_identity_change();
--> statement-breakpoint
CREATE TRIGGER tracks_set_updated_at BEFORE UPDATE ON public.tracks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER users_guard_erasure BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.guard_account_erasure();
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

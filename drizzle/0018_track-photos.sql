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
ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_purpose_check";--> statement-breakpoint
ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_size_check";--> statement-breakpoint
ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_ready_check";--> statement-breakpoint
ALTER TABLE "track_photo_versions" ADD CONSTRAINT "track_photo_versions_photo_id_track_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."track_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_photos" ADD CONSTRAINT "track_photos_id_stored_files_id_fk" FOREIGN KEY ("id") REFERENCES "public"."stored_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_photos" ADD CONSTRAINT "track_photos_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "track_photos_track_index" ON "track_photos" USING btree ("track_id");--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_purpose_check" CHECK ("stored_files"."purpose" IN ('avatar', 'gpx', 'photo'));--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_size_check" CHECK ("stored_files"."byte_size" > 0 AND "stored_files"."byte_size" <= CASE WHEN "stored_files"."purpose" = 'photo' THEN 46137344 ELSE 10485760 END);--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_ready_check" CHECK ("stored_files"."status" <> 'ready' OR ("stored_files"."content_type" IS NOT NULL AND "stored_files"."sha256" IS NOT NULL AND "stored_files"."sha256" ~ '^[a-f0-9]{64}$' AND (("stored_files"."purpose" = 'avatar' AND "stored_files"."content_type" ~ '^image/[a-z0-9][a-z0-9.+-]*$' AND "stored_files"."content_type" <> 'image/svg+xml') OR ("stored_files"."purpose" = 'gpx' AND "stored_files"."content_type" = 'application/gpx+xml') OR ("stored_files"."purpose" = 'photo' AND "stored_files"."content_type" IN ('image/jpeg','image/png','image/webp','image/avif')))));--> statement-breakpoint
CREATE TRIGGER track_photos_set_updated_at BEFORE UPDATE ON track_photos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER track_photo_versions_set_updated_at BEFORE UPDATE ON track_photo_versions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

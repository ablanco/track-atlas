ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_ready_check";--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "object_key" text;--> statement-breakpoint
UPDATE "stored_files" SET "object_key" = "id"::text;--> statement-breakpoint
ALTER TABLE "stored_files" ALTER COLUMN "object_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_file_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_file_id_stored_files_id_fk" FOREIGN KEY ("avatar_file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_object_key_check" CHECK ("stored_files"."object_key" = "stored_files"."id"::text OR ("stored_files"."purpose" = 'avatar' AND "stored_files"."object_key" = 'avatars/original/' || "stored_files"."id"::text));--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_ready_check" CHECK ("stored_files"."status" <> 'ready' OR ("stored_files"."content_type" IS NOT NULL AND "stored_files"."sha256" IS NOT NULL AND "stored_files"."sha256" ~ '^[a-f0-9]{64}$' AND (("stored_files"."purpose" = 'avatar' AND "stored_files"."content_type" IN ('image/jpeg', 'image/png', 'image/webp')) OR ("stored_files"."purpose" = 'gpx' AND "stored_files"."content_type" = 'application/gpx+xml'))));
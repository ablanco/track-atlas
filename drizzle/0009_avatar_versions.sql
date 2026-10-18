ALTER TABLE "stored_files" ADD COLUMN "avatar_128_bytes" integer;--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "avatar_128_sha256" text;--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "avatar_24_bytes" integer;--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "avatar_24_sha256" text;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_avatar_versions_check" CHECK ((
    "stored_files"."avatar_128_bytes" IS NULL AND "stored_files"."avatar_128_sha256" IS NULL AND "stored_files"."avatar_24_bytes" IS NULL AND "stored_files"."avatar_24_sha256" IS NULL
  ) OR (
    "stored_files"."purpose" = 'avatar' AND
    "stored_files"."avatar_128_bytes" IS NOT NULL AND "stored_files"."avatar_128_bytes" BETWEEN 1 AND 65536 AND
    "stored_files"."avatar_24_bytes" IS NOT NULL AND "stored_files"."avatar_24_bytes" BETWEEN 1 AND 65536 AND
    "stored_files"."avatar_128_sha256" IS NOT NULL AND "stored_files"."avatar_128_sha256" ~ '^[a-f0-9]{64}$' AND
    "stored_files"."avatar_24_sha256" IS NOT NULL AND "stored_files"."avatar_24_sha256" ~ '^[a-f0-9]{64}$'
  ));
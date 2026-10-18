CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_location" text NOT NULL,
	"byte_size" integer NOT NULL,
	"content_type" text,
	"sha256" text,
	"expires_at" timestamp with time zone DEFAULT now() + interval '15 minutes' NOT NULL,
	"delete_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_purpose_check" CHECK ("stored_files"."purpose" IN ('avatar', 'gpx')),
	CONSTRAINT "stored_files_status_check" CHECK ("stored_files"."status" IN ('pending', 'ready', 'deleting')),
	CONSTRAINT "stored_files_size_check" CHECK ("stored_files"."byte_size" > 0 AND "stored_files"."byte_size" <= 10485760),
	CONSTRAINT "stored_files_location_check" CHECK ("stored_files"."storage_location" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "stored_files_ready_check" CHECK ("stored_files"."status" <> 'ready' OR ("stored_files"."content_type" IS NOT NULL AND "stored_files"."sha256" IS NOT NULL AND "stored_files"."sha256" ~ '^[a-f0-9]{64}$' AND (("stored_files"."purpose" = 'avatar' AND "stored_files"."content_type" = 'image/webp') OR ("stored_files"."purpose" = 'gpx' AND "stored_files"."content_type" = 'application/gpx+xml')))),
	CONSTRAINT "stored_files_deleting_check" CHECK (("stored_files"."status" = 'deleting') = ("stored_files"."delete_after" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stored_files_owner_index" ON "stored_files" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "stored_files_cleanup_index" ON "stored_files" USING btree ("storage_location","status","expires_at");
--> statement-breakpoint
CREATE TRIGGER stored_files_set_updated_at
BEFORE UPDATE ON public.stored_files
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

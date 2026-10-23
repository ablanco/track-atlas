CREATE TABLE "deleted_track_uploads" (
	"owner_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deleted_track_uploads_owner_id_request_id_pk" PRIMARY KEY("owner_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "deleted_track_uploads" ADD CONSTRAINT "deleted_track_uploads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deleted_track_uploads_track_unique" ON "deleted_track_uploads" USING btree ("track_id");
--> statement-breakpoint
CREATE TRIGGER deleted_track_uploads_updated_at BEFORE UPDATE ON public.deleted_track_uploads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

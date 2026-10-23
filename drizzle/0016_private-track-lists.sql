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
ALTER TABLE "track_list_memberships" ADD CONSTRAINT "track_list_memberships_list_id_track_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."track_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_list_memberships" ADD CONSTRAINT "track_list_memberships_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_lists" ADD CONSTRAINT "track_lists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "track_list_memberships_track_index" ON "track_list_memberships" USING btree ("track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "track_lists_owner_name_unique" ON "track_lists" USING btree ("owner_id","normalized_name");--> statement-breakpoint
CREATE TRIGGER track_lists_set_updated_at BEFORE UPDATE ON public.track_lists FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER track_list_memberships_set_updated_at BEFORE UPDATE ON public.track_list_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

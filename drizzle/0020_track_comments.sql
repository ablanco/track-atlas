CREATE TABLE "discussion_post_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
ALTER TABLE "users" ADD COLUMN "discussion_emails_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discussion_email_locale" text;--> statement-breakpoint
ALTER TABLE "discussion_post_events" ADD CONSTRAINT "discussion_post_events_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_comment_replies" ADD CONSTRAINT "track_comment_replies_comment_id_track_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."track_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_comment_replies" ADD CONSTRAINT "track_comment_replies_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_comments" ADD CONSTRAINT "track_comments_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_comments" ADD CONSTRAINT "track_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discussion_post_events_author_time_index" ON "discussion_post_events" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "track_comment_replies_comment_unique" ON "track_comment_replies" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "track_comment_replies_author_index" ON "track_comment_replies" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "track_comments_page_index" ON "track_comments" USING btree ("track_id","created_at","id");--> statement-breakpoint
CREATE INDEX "track_comments_author_index" ON "track_comments" USING btree ("author_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_discussion_email_locale_check" CHECK ("users"."discussion_email_locale" IN ('en', 'es'));--> statement-breakpoint
CREATE TRIGGER track_comments_set_updated_at BEFORE UPDATE ON public.track_comments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER track_comment_replies_set_updated_at BEFORE UPDATE ON public.track_comment_replies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER discussion_post_events_set_updated_at BEFORE UPDATE ON public.discussion_post_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
